/* ======================================================
   ORENTI — редактирование с WYSIWYG + синхронизацией
   ====================================================== */
(function(){

  const CONFIG = {
    loginHash:    "ВСТАВЬ_ХЕШ_ЛОГИНА",
    passwordHash: "ВСТАВЬ_ХЕШ_ПАРОЛЯ",
    sessionHours: 72,
    showWhenLocked: false
  };

  const AUTH_KEY  = 'orenti-auth-until';
  const TOKEN_KEY = 'orenti-edit-token';
  const API_URL   = '/api/content';

  const PAGE_SLUG = (function(){
    const file = (location.pathname.split('/').pop() || 'index.html').split('?')[0];
    return file.replace(/\.html?$/i, '') || 'index';
  })();
  function pageKey(id){ return PAGE_SLUG + ':' + id; }

  async function sha256(str){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2,'0')).join('');
  }
  function saveSession(){ localStorage.setItem(AUTH_KEY, String(Date.now() + CONFIG.sessionHours*3600*1000)); }
  function clearSession(){ localStorage.removeItem(AUTH_KEY); localStorage.removeItem(TOKEN_KEY); }
  function isSessionValid(){ const v = Number(localStorage.getItem(AUTH_KEY)); return v && v > Date.now(); }

  // ---------- Контент с сервера ----------
  function getCleanContent(section){
    const c = section.cloneNode(true);
    c.querySelectorAll('.section-tools, .fmt-toolbar').forEach(el => el.remove());
    return c.innerHTML;
  }

  function applyContent(serverContent){
    document.querySelectorAll('section.block').forEach((section, idx) => {
      const id = section.id || ('sec-' + idx);
      const html = serverContent[pageKey(id)];
      if (html == null) return;
      section.querySelectorAll('.section-tools, .fmt-toolbar').forEach(el => el.remove());
      section.innerHTML = html;
    });
  }

  async function loadServerContent(){
    try {
      const res = await fetch(API_URL + '?t=' + Date.now(), { cache:'no-store' });
      if (!res.ok) return {};
      return await res.json();
    } catch(e){ return {}; }
  }

  // ---------- Авторизация ----------
  function showLoginModal(){
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)';
      const box = document.createElement('div');
      box.style.cssText = 'background:#141414;border:1px solid #262626;border-radius:10px;padding:26px;max-width:360px;width:90%;color:#fff;font-family:inherit';
      box.innerHTML = `
        <h3 style="margin:0 0 16px;font-size:17px;text-transform:uppercase;letter-spacing:.08em;font-weight:900">🔒 Вход для редактора</h3>
        <input type="text" id="__login" placeholder="Логин" autocomplete="username" style="width:100%;box-sizing:border-box;margin-bottom:10px;background:#0a0a0a;border:1px solid #3a3a3a;color:#fff;border-radius:6px;padding:12px 14px;outline:none;font-family:inherit;font-size:15px">
        <input type="password" id="__pwd" placeholder="Пароль" autocomplete="current-password" style="width:100%;box-sizing:border-box;margin-bottom:14px;background:#0a0a0a;border:1px solid #3a3a3a;color:#fff;border-radius:6px;padding:12px 14px;outline:none;font-family:inherit;font-size:15px">
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="__cancel" style="padding:10px 16px;border-radius:6px;border:1px solid #3a3a3a;background:#1a1a1a;color:#8a8a8a;cursor:pointer;font-family:inherit;font-size:13px;text-transform:uppercase;letter-spacing:.06em;font-weight:700">Отмена</button>
          <button id="__ok" style="padding:10px 16px;border-radius:6px;border:none;background:#ff3b3b;color:#fff;cursor:pointer;font-family:inherit;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.06em">Войти</button>
        </div>
        <div id="__err" style="color:#ff6b7a;font-size:13px;margin-top:12px;min-height:18px"></div>
      `;
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      const l = box.querySelector('#__login');
      const p = box.querySelector('#__pwd');
      l.focus();
      const close = v => { overlay.remove(); resolve(v); };
      box.querySelector('#__cancel').onclick = () => close(null);
      box.querySelector('#__ok').onclick = () => close({ l:l.value, p:p.value });
      const k = e => {
        if (e.key === 'Enter') close({ l:l.value, p:p.value });
        if (e.key === 'Escape') close(null);
      };
      l.onkeydown = k; p.onkeydown = k;
    });
  }

  async function promptLogin(){
    const creds = await showLoginModal();
    if (!creds) return;
    const [lh, ph] = await Promise.all([sha256(creds.l), sha256(creds.p)]);
    if (lh === CONFIG.loginHash && ph === CONFIG.passwordHash) {
      saveSession();
      localStorage.setItem(TOKEN_KEY, creds.p);
      location.reload();
    } else {
      alert('Неверный логин или пароль');
      promptLogin();
    }
  }

  function showLockButton(authorized){
    const btn = document.createElement('button');
    btn.id = 'auth-btn';
    btn.textContent = authorized ? '🚪' : '🔒';
    btn.title = authorized ? 'Выйти из режима редактора' : 'Войти как редактор';
    btn.addEventListener('click', () => {
      if (authorized) {
        if (confirm('Выйти из режима редактирования?')) { clearSession(); location.reload(); }
      } else promptLogin();
    });
    document.body.appendChild(btn);
  }

  // =====================================================
  // WYSIWYG-панель
  // =====================================================
  let savedRange = null;

  function saveSelection(){
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRange = sel.getRangeAt(0).cloneRange();
  }

  function restoreSelection(){
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  function exec(cmd, val){
    restoreSelection();
    document.execCommand(cmd, false, val ?? null);
    saveSelection();
    updateToolbarState();
  }

  function updateToolbarState(){
    document.querySelectorAll('.fmt-toolbar button[data-cmd]').forEach(btn => {
      const cmd = btn.dataset.cmd;
      try {
        if (document.queryCommandState(cmd)) btn.classList.add('active');
        else btn.classList.remove('active');
      } catch(e){}
    });
  }

 function buildFormatToolbar(section){
  const bar = document.createElement('div');
  bar.className = 'fmt-toolbar';
  bar.setAttribute('contenteditable','false');
  bar.innerHTML = `
    <button type="button" class="fmt-close" title="Скрыть панель">✕</button>
    <button type="button" data-cmd="bold" title="Жирный (Ctrl+B)"><b>B</b></button>
    <button type="button" data-cmd="italic" title="Курсив (Ctrl+I)"><i>I</i></button>
    <button type="button" data-cmd="underline" title="Подчёркнутый (Ctrl+U)"><u>U</u></button>
    <button type="button" data-cmd="strikeThrough" title="Зачёркнутый"><s>S</s></button>
    <span class="sep"></span>
    <select data-format title="Стиль абзаца">
      <option value="p">Абзац</option>
      <option value="h2">Заголовок 2</option>
      <option value="h3">Заголовок 3</option>
      <option value="blockquote">Цитата</option>
    </select>
    <span class="sep"></span>
    <button type="button" data-cmd="insertUnorderedList" title="Маркированный список">• ≡</button>
    <button type="button" data-cmd="insertOrderedList" title="Нумерованный список">1. ≡</button>
    <span class="sep"></span>
    <label title="Цвет текста">
      <span class="swatch fg">A</span>
      <input type="color" data-color="foreColor" value="#ff3b3b">
    </label>
    <label title="Цвет фона (маркер)">
      <span class="swatch bg">A</span>
      <input type="color" data-color="hiliteColor" value="#ffeb3b">
    </label>
    <button type="button" id="eyedropper" title="Пипетка — взять цвет с экрана">🎨</button>
    <span class="sep"></span>
    <button type="button" data-cmd="createLink" title="Вставить ссылку">🔗</button>
    <button type="button" data-cmd="unlink" title="Убрать ссылку">⛓️‍💥</button>
    <button type="button" data-cmd="removeFormat" title="Очистить формат">✕A</button>
  `;

  // --- Кнопки форматирования ---
  bar.querySelectorAll('button[data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'createLink') {
        const url = prompt('URL ссылки:', 'https://');
        if (url) exec('createLink', url);
      } else {
        exec(cmd);
      }
    });
  });

  // --- Селект стиля абзаца ---
  bar.querySelector('select[data-format]').addEventListener('change', function(){
    exec('formatBlock', '<' + this.value + '>');
  });

  // --- Цвета ---
  bar.querySelectorAll('input[type="color"]').forEach(inp => {
    inp.addEventListener('input', function(){
      exec(this.dataset.color, this.value);
    });
  });

  // --- Пипетка ---
  const dropBtn = bar.querySelector('#eyedropper');
  if (window.EyeDropper) {
    dropBtn.addEventListener('mousedown', e => e.preventDefault());
    dropBtn.addEventListener('click', async () => {
      try {
        const result = await new window.EyeDropper().open();
        exec('foreColor', result.sRGBHex);
      } catch(e){}
    });
  } else {
    dropBtn.style.display = 'none';
  }

  // --- Скрыть панель ---
  bar.querySelector('.fmt-close').addEventListener('click', e => {
    e.stopPropagation();
    bar.remove();
    localStorage.setItem('orenti-fmtbar-hidden', '1');
  });

  // --- Сохранение выделения ---
  section.addEventListener('keyup', saveSelection);
  section.addEventListener('mouseup', saveSelection);
  section.addEventListener('input', updateToolbarState);

  // --- Перетаскивание ---
  makeDraggable(bar);

  return bar;
}

/* Перетаскивание панели */
function makeDraggable(bar){
  // Восстанавливаем позицию из localStorage
  try {
    const savedPos = JSON.parse(localStorage.getItem('orenti-fmtbar-pos') || 'null');
    if (savedPos && typeof savedPos.x === 'number' && typeof savedPos.y === 'number') {
      bar.style.left = savedPos.x + 'px';
      bar.style.top  = savedPos.y + 'px';
      bar.style.bottom = 'auto';
    }
  } catch(e){}

  let drag = false;
  let startX = 0, startY = 0, offsetX = 0, offsetY = 0;

  // Только при клике именно по ручке (::before — псевдоэлемент, но клик по нему
  // ловится как клик по самому бару слева в области 32px)
  const HANDLE_WIDTH = 32;

  bar.addEventListener('mousedown', e => {
    const rect = bar.getBoundingClientRect();
    const inHandle = (e.clientX - rect.left) < HANDLE_WIDTH;
    if (!inHandle) return;
    if (e.target.closest('button, select, label, input')) return;

    e.preventDefault();
    drag = true;
    bar.classList.add('dragging');

    startX = e.clientX;
    startY = e.clientY;
    const r = bar.getBoundingClientRect();
    offsetX = startX - r.left;
    offsetY = startY - r.top;

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // То же для тач-устройств
  bar.addEventListener('touchstart', e => {
    const rect = bar.getBoundingClientRect();
    const touch = e.touches[0];
    const inHandle = (touch.clientX - rect.left) < HANDLE_WIDTH;
    if (!inHandle) return;
    if (e.target.closest('button, select, label, input')) return;

    drag = true;
    bar.classList.add('dragging');

    startX = touch.clientX;
    startY = touch.clientY;
    const r = bar.getBoundingClientRect();
    offsetX = startX - r.left;
    offsetY = startY - r.top;

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  }, { passive: true });

  function onMove(e){
    if (!drag) return;
    moveTo(e.clientX, e.clientY);
  }
  function onTouchMove(e){
    if (!drag) return;
    e.preventDefault();
    const t = e.touches[0];
    moveTo(t.clientX, t.clientY);
  }
  function moveTo(cx, cy){
    let x = cx - offsetX;
    let y = cy - offsetY;

    // Не выпускаем за границы экрана
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    x = Math.max(4, Math.min(window.innerWidth  - w - 4, x));
    y = Math.max(4, Math.min(window.innerHeight - h - 4, y));

    bar.style.left = x + 'px';
    bar.style.top  = y + 'px';
    bar.style.bottom = 'auto';
  }
  function onUp(){
    if (!drag) return;
    drag = false;
    bar.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);

    // Сохраняем позицию
    const r = bar.getBoundingClientRect();
    localStorage.setItem('orenti-fmtbar-pos', JSON.stringify({ x: r.left, y: r.top }));
  }
  function onTouchEnd(){
    if (!drag) return;
    drag = false;
    bar.classList.remove('dragging');
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onTouchEnd);

    const r = bar.getBoundingClientRect();
    localStorage.setItem('orenti-fmtbar-pos', JSON.stringify({ x: r.left, y: r.top }));
  }
}

    // Селект "стиль абзаца"
    bar.querySelector('select[data-format]').addEventListener('change', function(){
      exec('formatBlock', '<' + this.value + '>');
    });

    // Цвет текста / фона
    bar.querySelectorAll('input[type="color"]').forEach(inp => {
      inp.addEventListener('input', function(){
        exec(this.dataset.color, this.value);
      });
    });

    // Пипетка
    const dropBtn = bar.querySelector('#eyedropper');
    if (window.EyeDropper) {
      dropBtn.addEventListener('mousedown', e => e.preventDefault());
      dropBtn.addEventListener('click', async () => {
        try {
          const result = await new window.EyeDropper().open();
          exec('foreColor', result.sRGBHex);
        } catch(e){}
      });
    } else {
      dropBtn.style.display = 'none';
    }

    // Сохраняем выделение при вводе текста и кликах в области
    section.addEventListener('keyup', saveSelection);
    section.addEventListener('mouseup', saveSelection);
    section.addEventListener('input', updateToolbarState);

    return bar;
  }

  // =====================================================
  // Редактор разделов
  // =====================================================
  function attachEditors(serverContent){
    let cache = {};
    const cacheKey = 'orenti-edit-cache:' + PAGE_SLUG;
    try { cache = JSON.parse(localStorage.getItem(cacheKey) || '{}'); } catch(e){}
    const merged = { ...cache, ...serverContent };

    document.querySelectorAll('section.block').forEach((section, idx) => {
      const id = section.id || ('sec-' + idx);
      const key = pageKey(id);
      const originalContent = getCleanContent(section);

      section.querySelectorAll('.section-tools, .fmt-toolbar').forEach(el => el.remove());

      const tools = document.createElement('div');
      tools.className = 'section-tools';
      tools.setAttribute('contenteditable','false');
      section.appendChild(tools);

      let backup = '';
      let fmtBar = null;

      function renderNormal(){
        section.contentEditable = 'false';
        section.classList.remove('editing');
        // Убираем все панели форматирования с экрана
document.querySelectorAll('.fmt-toolbar').forEach(el => el.remove());
fmtBar = null;
        tools.innerHTML =
            '<button type="button" class="edit">✏️ Редактировать</button>'
          + (merged[key] ? ' <button type="button" class="reset">🗑 Сбросить</button>' : '');
        tools.querySelector('.edit').addEventListener('click', startEdit);
        const r = tools.querySelector('.reset');
        if (r) r.addEventListener('click', resetEdit);
      }

      function renderEditing(){
        section.contentEditable = 'true';
        section.classList.add('editing');
        tools.innerHTML =
            '<button type="button" class="save">💾 Сохранить</button>'
          + '<button type="button" class="cancel">↺ Отмена</button>'
          + '<button type="button" class="reset">🗑 Сбросить</button>';
        tools.querySelector('.save').addEventListener('click', saveEdit);
        tools.querySelector('.cancel').addEventListener('click', cancelEdit);
        tools.querySelector('.reset').addEventListener('click', resetEdit);

       // Панель уже создана?
let exists = document.querySelector('.fmt-toolbar');
if (!exists) {
  const hidden = localStorage.getItem('orenti-fmtbar-hidden') === '1';
  if (!hidden) {
    fmtBar = buildFormatToolbar(section);
    document.body.appendChild(fmtBar);
  }
}
      }

      function startEdit(){
        backup = getCleanContent(section);
        renderEditing();
        section.focus({ preventScroll:true });
        // Первый диапазон = начало секции
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(section);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        saveSelection();
      }

      async function saveEdit(){
        // Забираем контент ДО выхода из редактирования (пока панель ещё в DOM - не мешает)
        const newContent = getCleanContent(section);
        const candidate  = { ...merged, [key]: newContent };

        tools.innerHTML = '<span class="saved-msg">⏳ Сохраняю...</span>';

        try {
          const res = await fetch(API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '')
            },
            body: JSON.stringify(candidate)
          });
          if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error('HTTP ' + res.status + ' ' + t);
          }
          merged[key] = newContent;
          localStorage.setItem(cacheKey, JSON.stringify(merged));
          renderNormal();
          flash('✓ Сохранено для всех');
        } catch(e) {
          console.error('Save failed:', e);
          tools.innerHTML =
              '<button type="button" class="save">💾 Сохранить</button>'
            + '<button type="button" class="cancel">↺ Отмена</button>'
            + '<button type="button" class="reset">🗑 Сбросить</button>'
            + '<span class="saved-msg" style="background:#ff3b3b;color:#fff">⚠ ' + e.message + '</span>';
          tools.querySelector('.save').addEventListener('click', saveEdit);
          tools.querySelector('.cancel').addEventListener('click', cancelEdit);
          tools.querySelector('.reset').addEventListener('click', resetEdit);
        }
      }

      function cancelEdit(){
        section.innerHTML = backup;
        section.appendChild(tools);
        renderNormal();
      }

      async function resetEdit(){
        if (!confirm('Сбросить изменения этого раздела?')) return;
        delete merged[key];
        try {
          await fetch(API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '')
            },
            body: JSON.stringify(merged)
          });
          localStorage.setItem(cacheKey, JSON.stringify(merged));
        } catch(e) {}
        section.innerHTML = originalContent;
        section.appendChild(tools);
        renderNormal();
        flash('↺ Сброшено');
      }

      function flash(text){
        const m = document.createElement('span');
        m.className = 'saved-msg';
        m.textContent = text;
        tools.appendChild(m);
        setTimeout(() => m.remove(), 2000);
      }

      if (merged[key]) {
        section.innerHTML = merged[key];
        section.appendChild(tools);
      }
      renderNormal();
    });
  }

  // ---------- Запуск ----------
  (async function init(){
    const serverContent = await loadServerContent();
    applyContent(serverContent);

    const authorized = isSessionValid();
    if (authorized) {
      attachEditors(serverContent);
      showLockButton(true);
    } else {
      showLockButton(false);
      if (CONFIG.showWhenLocked) attachEditors(serverContent);
    }
  })();

})();
