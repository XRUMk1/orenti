/* ======================================================
   ORENTI — редактор с WYSIWYG, sync и добавлением разделов
   ====================================================== */
(function(){

  // ============== НАСТРОЙКИ ==============
  const CONFIG = {
    loginHash:    "9313181f777104d96a4034374e26f0a6fc2af94a1b6d3f9db97067af6f85b11d",
    passwordHash: "94c69adfda279ab3f7c3dd90a9f59e4f06471f2344719c93f5e96c314af91fb6",
    sessionHours: 72,
    showWhenLocked: false
  };
  // ============ / НАСТРОЙКИ =============

  const AUTH_KEY  = 'orenti-auth-until';
  const TOKEN_KEY = 'orenti-edit-token';
  const API_URL   = '/api/content';

  const PAGE_SLUG = (function(){
    const file = (location.pathname.split('/').pop() || 'index.html').split('?')[0];
    return file.replace(/\.html?$/i, '') || 'index';
  })();
  const META_KEY = '__sections__:' + PAGE_SLUG;

  function pageKey(id){ return PAGE_SLUG + ':' + id; }

  // ---------- утилиты ----------
  async function sha256(str){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2,'0')).join('');
  }
  function saveSession(){ localStorage.setItem(AUTH_KEY, String(Date.now() + CONFIG.sessionHours*3600*1000)); }
  function clearSession(){ localStorage.removeItem(AUTH_KEY); localStorage.removeItem(TOKEN_KEY); }
  function isSessionValid(){ const v = Number(localStorage.getItem(AUTH_KEY)); return v && v > Date.now(); }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // ---------- Контент ----------
  function getCleanContent(section){
    const c = section.cloneNode(true);
    c.querySelectorAll('.section-tools').forEach(el => el.remove());
    return c.innerHTML;
  }

  function findSectionsContainer(){
    const first = document.querySelector('section.block');
    return first ? first.parentElement : null;
  }

  function getTOC(){ return document.querySelector('.toc'); }

  // Создаём кастомные секции, которых ещё нет в DOM
  function renderCustomSections(serverContent){
    const list = serverContent[META_KEY] || [];
    const container = findSectionsContainer();
    if (!container) return;
    const toc = getTOC();

    list.forEach(item => {
      if (document.getElementById(item.id)) return;
      const section = document.createElement('section');
      section.className = 'block';
      section.id = item.id;
      section.dataset.custom = '1';
      section.innerHTML = '<h2>' + escapeHtml(item.title || 'Раздел') + '</h2><p></p>';
      container.appendChild(section);

      if (toc) {
        const a = document.createElement('a');
        a.href = '#' + item.id;
        a.dataset.customNav = item.id;
        a.textContent = item.title || 'Раздел';
        toc.appendChild(a);
      }
    });
  }

  function applyContent(serverContent){
    document.querySelectorAll('section.block').forEach((section, idx) => {
      const id = section.id || ('sec-' + idx);
      const html = serverContent[pageKey(id)];
      if (html == null) return;
      section.querySelectorAll('.section-tools').forEach(el => el.remove());
      section.innerHTML = html;
    });
  }

  // Обновляем названия кастомных секций в TOC по актуальному H2
  function syncTOC(){
    document.querySelectorAll('.toc a[data-custom-nav]').forEach(a => {
      const id = a.dataset.customNav;
      const sec = document.getElementById(id);
      if (!sec) return;
      const h = sec.querySelector('h2');
      if (h && h.textContent.trim()) a.textContent = h.textContent.trim();
    });
  }

  async function loadServerContent(){
    try {
      const res = await fetch(API_URL + '?t=' + Date.now(), { cache:'no-store' });
      if (!res.ok) return {};
      return await res.json();
    } catch(e){ return {}; }
  }

  async function postContent(obj){
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '')
      },
      body: JSON.stringify(obj)
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('HTTP ' + res.status + ' ' + t);
    }
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
  // WYSIWYG-панель (без крестика)
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
      try {
        if (document.queryCommandState(btn.dataset.cmd)) btn.classList.add('active');
        else btn.classList.remove('active');
      } catch(e){}
    });
  }

  function makeDraggable(bar){
    try {
      const pos = JSON.parse(localStorage.getItem('orenti-fmtbar-pos') || 'null');
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        bar.style.left = pos.x + 'px';
        bar.style.top  = pos.y + 'px';
        bar.style.bottom = 'auto';
      }
    } catch(e){}

    let drag = false, offX = 0, offY = 0;
    const HANDLE = 36;

    function start(cx, cy){
      const r = bar.getBoundingClientRect();
      if ((cx - r.left) > HANDLE) return false;
      drag = true;
      bar.classList.add('dragging');
      offX = cx - r.left;
      offY = cy - r.top;
      return true;
    }
    function move(cx, cy){
      if (!drag) return;
      let x = cx - offX, y = cy - offY;
      const w = bar.offsetWidth, h = bar.offsetHeight;
      x = Math.max(4, Math.min(window.innerWidth  - w - 4, x));
      y = Math.max(4, Math.min(window.innerHeight - h - 4, y));
      bar.style.left = x + 'px';
      bar.style.top  = y + 'px';
      bar.style.bottom = 'auto';
    }
    function end(){
      if (!drag) return;
      drag = false;
      bar.classList.remove('dragging');
      const r = bar.getBoundingClientRect();
      localStorage.setItem('orenti-fmtbar-pos', JSON.stringify({ x:r.left, y:r.top }));
    }

    bar.addEventListener('mousedown', e => {
      if (e.target.closest('button, select, label, input')) return;
      if (start(e.clientX, e.clientY)) e.preventDefault();
    });
    document.addEventListener('mousemove', e => move(e.clientX, e.clientY));
    document.addEventListener('mouseup', end);

    bar.addEventListener('touchstart', e => {
      if (e.target.closest('button, select, label, input')) return;
      const t = e.touches[0];
      if (start(t.clientX, t.clientY)) e.preventDefault();
    }, { passive:false });
    document.addEventListener('touchmove', e => {
      if (!drag) return;
      const t = e.touches[0];
      e.preventDefault();
      move(t.clientX, t.clientY);
    }, { passive:false });
    document.addEventListener('touchend', end);
  }

  function buildFormatToolbar(section){
    const bar = document.createElement('div');
    bar.className = 'fmt-toolbar';
    bar.setAttribute('contenteditable','false');
    bar.innerHTML = `
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
      <button type="button" id="eyedropper" title="Пипетка">🎨</button>
      <span class="sep"></span>
      <button type="button" data-cmd="createLink" title="Вставить ссылку">🔗</button>
      <button type="button" data-cmd="unlink" title="Убрать ссылку">⛓</button>
      <button type="button" data-cmd="removeFormat" title="Очистить формат">✕A</button>
    `;

    bar.querySelectorAll('button[data-cmd]').forEach(btn => {
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd;
        if (cmd === 'createLink') {
          const url = prompt('URL ссылки:', 'https://');
          if (url) exec('createLink', url);
        } else exec(cmd);
      });
    });

    bar.querySelector('select[data-format]').addEventListener('change', function(){
      exec('formatBlock', '<' + this.value + '>');
    });

    bar.querySelectorAll('input[type="color"]').forEach(inp => {
      inp.addEventListener('input', function(){
        exec(this.dataset.color, this.value);
      });
    });

    const dropBtn = bar.querySelector('#eyedropper');
    if (window.EyeDropper) {
      dropBtn.addEventListener('mousedown', e => e.preventDefault());
      dropBtn.addEventListener('click', async () => {
        try {
          const r = await new window.EyeDropper().open();
          exec('foreColor', r.sRGBHex);
        } catch(e){}
      });
    } else dropBtn.style.display = 'none';

    section.addEventListener('keyup', saveSelection);
    section.addEventListener('mouseup', saveSelection);
    section.addEventListener('input', updateToolbarState);

    makeDraggable(bar);
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
      const isCustom = section.dataset.custom === '1';

      section.querySelectorAll('.section-tools').forEach(el => el.remove());

      const tools = document.createElement('div');
      tools.className = 'section-tools';
      tools.setAttribute('contenteditable','false');
      section.appendChild(tools);

      let backup = '';

      function removeToolbar(){
        document.querySelectorAll('.fmt-toolbar').forEach(el => el.remove());
      }

      function renderNormal(){
        section.contentEditable = 'false';
        section.classList.remove('editing');
        removeToolbar();
        tools.innerHTML =
            '<button type="button" class="edit">✏️ Редактировать</button>'
          + (merged[key] ? ' <button type="button" class="reset">🗑 Сбросить</button>' : '')
          + (isCustom    ? ' <button type="button" class="delete">🗑 Удалить раздел</button>' : '');
        tools.querySelector('.edit').addEventListener('click', startEdit);
        const r = tools.querySelector('.reset');
        if (r) r.addEventListener('click', resetEdit);
        const d = tools.querySelector('.delete');
        if (d) d.addEventListener('click', () => deleteSection(id));
      }

      function renderEditing(){
        section.contentEditable = 'true';
        section.classList.add('editing');
        tools.innerHTML =
            '<button type="button" class="save">💾 Сохранить</button>'
          + '<button type="button" class="cancel">↺ Отмена</button>'
          + '<button type="button" class="reset">🗑 Сбросить</button>'
          + (isCustom ? ' <button type="button" class="delete">🗑 Удалить раздел</button>' : '');
        tools.querySelector('.save').addEventListener('click', saveEdit);
        tools.querySelector('.cancel').addEventListener('click', cancelEdit);
        tools.querySelector('.reset').addEventListener('click', resetEdit);
        const d = tools.querySelector('.delete');
        if (d) d.addEventListener('click', () => deleteSection(id));

        removeToolbar();
        const bar = buildFormatToolbar(section);
        document.body.appendChild(bar);
      }

      function startEdit(){
        backup = getCleanContent(section);
        renderEditing();
        section.focus({ preventScroll:true });
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(section);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        saveSelection();
      }

      async function saveEdit(){
        const newContent = getCleanContent(section);
        const candidate  = { ...merged, [key]: newContent };
        tools.innerHTML = '<span class="saved-msg">⏳ Сохраняю...</span>';

        try {
          await postContent(candidate);
          merged[key] = newContent;
          localStorage.setItem(cacheKey, JSON.stringify(merged));
          renderNormal();
          syncTOC();
          flash('✓ Сохранено для всех');
        } catch(e) {
          console.error('Save failed:', e);
          tools.innerHTML =
              '<button type="button" class="save">💾 Сохранить</button>'
            + '<button type="button" class="cancel">↺ Отмена</button>'
            + '<button type="button" class="reset">🗑 Сбросить</button>'
            + (isCustom ? ' <button type="button" class="delete">🗑 Удалить раздел</button>' : '')
            + '<span class="saved-msg" style="background:#ff3b3b;color:#fff">⚠ ' + e.message + '</span>';
          tools.querySelector('.save').addEventListener('click', saveEdit);
          tools.querySelector('.cancel').addEventListener('click', cancelEdit);
          tools.querySelector('.reset').addEventListener('click', resetEdit);
          const d = tools.querySelector('.delete');
          if (d) d.addEventListener('click', () => deleteSection(id));
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
          await postContent(merged);
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

  // =====================================================
  // Добавление / удаление разделов (только админ)
  // =====================================================
  function showAddButton(){
    const toc = getTOC();
    if (!toc) return;
    if (toc.querySelector('.toc-add')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toc-add';
    btn.textContent = '➕ Добавить раздел';
    btn.addEventListener('click', addSection);
    toc.appendChild(btn);
  }

  async function addSection(){
    const title = prompt('Название нового раздела:', 'Новый раздел');
    if (title === null) return;
    const cleanTitle = (title || 'Новый раздел').trim() || 'Новый раздел';

    const id = 'custom-' + Date.now().toString(36);

    const container = findSectionsContainer();
    if (!container) { alert('Не найден контейнер разделов'); return; }

    // 1) Создаём секцию в DOM
    const section = document.createElement('section');
    section.className = 'block';
    section.id = id;
    section.dataset.custom = '1';
    section.innerHTML = '<h2>' + escapeHtml(cleanTitle) + '</h2>'
      + '<p>Нажми «✏️ Редактировать», чтобы заполнить этот раздел.</p>';
    container.appendChild(section);

    // 2) Добавляем в TOC
    const toc = getTOC();
    if (toc) {
      const a = document.createElement('a');
      a.href = '#' + id;
      a.dataset.customNav = id;
      a.textContent = cleanTitle;
      const addBtn = toc.querySelector('.toc-add');
      if (addBtn) toc.insertBefore(a, addBtn);
      else toc.appendChild(a);
    }

    // 3) Сохраняем в облако
    try {
      const serverContent = await loadServerContent();
      const list = serverContent[META_KEY] || [];
      list.push({ id, title: cleanTitle });
      serverContent[META_KEY] = list;
      serverContent[pageKey(id)] = section.innerHTML;
      await postContent(serverContent);
    } catch(e) {
      alert('Не удалось сохранить раздел: ' + e.message);
      location.reload();
      return;
    }

    // 4) Перезагружаем страницу — редактор подхватит новую секцию
    location.reload();
  }

  async function deleteSection(id){
    if (!confirm('Удалить этот раздел? Действие необратимо.')) return;

    try {
      const serverContent = await loadServerContent();
      const list = (serverContent[META_KEY] || []).filter(x => x.id !== id);
      serverContent[META_KEY] = list;
      delete serverContent[pageKey(id)];
      await postContent(serverContent);

      // Очищаем локальный кэш от этого ключа
      ['orenti-edit-cache:moderators','orenti-edit-cache:ga-zga','orenti-edit-cache:support','orenti-edit-cache:index','orenti-edit-cache:helpers'].forEach(k => {
        try {
          const c = JSON.parse(localStorage.getItem(k) || '{}');
          delete c[pageKey(id)];
          localStorage.setItem(k, JSON.stringify(c));
        } catch(e){}
      });
    } catch(e) {
      alert('Не удалось удалить: ' + e.message);
      return;
    }

    location.reload();
  }

  // =====================================================
  // Запуск
  // =====================================================
  (async function init(){
    const serverContent = await loadServerContent();

    // 1) Сначала создаём кастомные секции (если их ещё нет в DOM)
    renderCustomSections(serverContent);

    // 2) Затем применяем контент
    applyContent(serverContent);

    // 3) Обновляем названия кастомных секций в TOC
    syncTOC();

    const authorized = isSessionValid();
    if (authorized) {
      attachEditors(serverContent);
      showAddButton();
      showLockButton(true);
    } else {
      showLockButton(false);
    }
  })();

})();
