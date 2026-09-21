/* ======================================================
   ORENTI — редактирование с синхронизацией через Vercel Blob
   • Контент с сервера применяется для ВСЕХ посетителей
   • Кнопки редактирования видны только после логина
   ====================================================== */
(function(){

  // ============== НАСТРОЙКИ ==============
  const CONFIG = {
    loginHash:    "ВСТАВЬ_ХЕШ_ЛОГИНА",
    passwordHash: "ВСТАВЬ_ХЕШ_ПАРОЛЯ",
    sessionHours: 72,
    showWhenLocked: false
  };
  // ============ / НАСТРОЙКИ ==============

  const AUTH_KEY  = 'orenti-auth-until';
  const TOKEN_KEY = 'orenti-edit-token';
  const PAGE_KEY  = 'orenti-edit-cache:' + location.pathname;
  const API_URL   = '/api/content';

  // ---------- утилиты ----------
  async function sha256(str){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2,'0')).join('');
  }
  function saveSession(){
    localStorage.setItem(AUTH_KEY, String(Date.now() + CONFIG.sessionHours * 3600 * 1000));
  }
  function clearSession(){
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }
  function isSessionValid(){
    const v = Number(localStorage.getItem(AUTH_KEY));
    return v && v > Date.now();
  }

  // =====================================================
  // ЧАСТЬ 1. Применение контента с сервера — для ВСЕХ
  // =====================================================
  function getCleanContent(section){
    const c = section.cloneNode(true);
    c.querySelectorAll('.section-tools').forEach(el => el.remove());
    return c.innerHTML;
  }

  function applyContent(serverContent){
    document.querySelectorAll('section.block').forEach(section => {
      if (!section.id) return;
      const html = serverContent[section.id];
      if (html == null) return;
      // Убираем возможную панель инструментов перед заменой
      section.querySelectorAll('.section-tools').forEach(el => el.remove());
      section.innerHTML = html;
    });
  }

  async function loadServerContent(){
    try {
      const res = await fetch(API_URL, { cache: 'no-store' });
      if (!res.ok) {
        console.warn('Не удалось получить контент, статус:', res.status);
        return {};
      }
      return await res.json();
    } catch(e) {
      console.warn('Ошибка загрузки контента:', e);
      return {};
    }
  }

  // =====================================================
  // ЧАСТЬ 2. Редактор — только для админа
  // =====================================================
  function showLoginModal(){
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)';
      const box = document.createElement('div');
      box.style.cssText = 'background:#121620;border:1px solid #273041;border-radius:16px;padding:26px;max-width:360px;width:90%;color:#eef2f7;font-family:inherit';
      box.innerHTML = `
        <h3 style="margin:0 0 16px;font-size:19px">🔒 Вход для редактора</h3>
        <input type="text" id="__login" placeholder="Логин" autocomplete="username" style="width:100%;box-sizing:border-box;margin-bottom:10px;background:#0b0d12;border:1px solid #273041;color:#eef2f7;border-radius:10px;padding:12px 14px;outline:none;font-family:inherit;font-size:15px">
        <input type="password" id="__pwd" placeholder="Пароль" autocomplete="current-password" style="width:100%;box-sizing:border-box;margin-bottom:14px;background:#0b0d12;border:1px solid #273041;color:#eef2f7;border-radius:10px;padding:12px 14px;outline:none;font-family:inherit;font-size:15px">
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="__cancel" style="padding:10px 16px;border-radius:9px;border:1px solid #273041;background:#171c27;color:#eef2f7;cursor:pointer;font-family:inherit;font-size:14px">Отмена</button>
          <button id="__ok" style="padding:10px 16px;border-radius:9px;border:none;background:#7c9cff;color:#fff;cursor:pointer;font-family:inherit;font-weight:600;font-size:14px">Войти</button>
        </div>
        <div id="__err" style="color:#ff6b7a;font-size:13px;margin-top:12px;min-height:18px"></div>
      `;
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      const loginEl = box.querySelector('#__login');
      const pwdEl   = box.querySelector('#__pwd');
      loginEl.focus();
      const close = (val) => { overlay.remove(); resolve(val); };
      box.querySelector('#__cancel').onclick = () => close(null);
      box.querySelector('#__ok').onclick     = () => close({ l: loginEl.value, p: pwdEl.value });
      const onKey = (e) => {
        if (e.key === 'Enter')  close({ l: loginEl.value, p: pwdEl.value });
        if (e.key === 'Escape') close(null);
      };
      loginEl.onkeydown = onKey;
      pwdEl.onkeydown   = onKey;
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
    btn.addEventListener('click', async () => {
      if (authorized) {
        if (confirm('Выйти из режима редактирования?')) {
          clearSession();
          location.reload();
        }
      } else {
        promptLogin();
      }
    });
    document.body.appendChild(btn);
  }

  // ---------- редактор: добавляет кнопки и умеет сохранять ----------
  function attachEditors(serverContent){
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem(PAGE_KEY) || '{}'); } catch(e){}
    const merged = { ...cache, ...serverContent };

    document.querySelectorAll('section.block').forEach(section => {
      if (!section.id) section.id = 'sec-' + Math.random().toString(36).slice(2,8);
      const id = section.id;
      const originalContent = getCleanContent(section);

      // Убираем панель, если она там случайно уже есть
      section.querySelectorAll('.section-tools').forEach(el => el.remove());

      const tools = document.createElement('div');
      tools.className = 'section-tools';
      tools.setAttribute('contenteditable','false');
      section.appendChild(tools);

      let backup = '';

      function renderNormal(){
        section.contentEditable = 'false';
        section.classList.remove('editing');
        tools.innerHTML =
            '<button type="button" class="edit">✏️ Редактировать</button>'
          + (merged[id] ? ' <button type="button" class="reset">🗑 Сбросить</button>' : '');
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
      }

      function startEdit(){
        backup = getCleanContent(section);
        renderEditing();
        section.focus({ preventScroll: true });
      }

      async function saveEdit(){
        const newContent = getCleanContent(section);
        const candidate  = { ...merged, [id]: newContent };

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

          merged[id] = newContent;
          localStorage.setItem(PAGE_KEY, JSON.stringify(merged));

          section.contentEditable = 'false';
          section.classList.remove('editing');
          renderNormal();
          flash('✓ Сохранено для всех');
        } catch(e) {
          console.error('Save failed:', e);
          tools.innerHTML =
              '<button type="button" class="save">💾 Сохранить</button>'
            + '<button type="button" class="cancel">↺ Отмена</button>'
            + '<button type="button" class="reset">🗑 Сбросить</button>'
            + '<span class="saved-msg" style="background:#ff6b7a;color:#fff">⚠ ' + e.message + '</span>';
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
        delete merged[id];
        try {
          await fetch(API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '')
            },
            body: JSON.stringify(merged)
          });
          localStorage.setItem(PAGE_KEY, JSON.stringify(merged));
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

      if (merged[id]) {
        section.innerHTML = merged[id];
        section.appendChild(tools);
      }
      renderNormal();
    });
  }

  // =====================================================
  // Запуск
  // =====================================================
  (async function init(){
    // 1) Всегда подтягиваем контент с сервера и применяем — для всех
    const serverContent = await loadServerContent();
    applyContent(serverContent);

    // 2) Если админ — добавляем редактор
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
