/* ======================================================
   ORENTI — редактирование с синхронизацией через Vercel Blob
   ====================================================== */
(function(){

  // ============== НАСТРОЙКИ ==============
  const CONFIG = {
    // SHA-256 хеш логина и пароля (см. инструкцию)
    loginHash:    "9313181f777104d96a4034374e26f0a6fc2af94a1b6d3f9db97067af6f85b11d",
    passwordHash: "94c69adfda279ab3f7c3dd90a9f59e4f06471f2344719c93f5e96c314af91fb6",
    sessionHours: 72,
    showWhenLocked: false
  };
  // ============ / НАСТРОЙКИ ==============

  const AUTH_KEY = 'orenti-auth-until';
  const TOKEN_KEY = 'orenti-edit-token';
  const PAGE_KEY = 'orenti-edit-cache:' + location.pathname;

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

  // ---------- модальное окно входа ----------
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
      const pwdEl = box.querySelector('#__pwd');
      loginEl.focus();
      const close = (val) => { overlay.remove(); resolve(val); };
      box.querySelector('#__cancel').onclick = () => close(null);
      box.querySelector('#__ok').onclick = () => close({ l: loginEl.value, p: pwdEl.value });
      const onKey = (e) => {
        if (e.key === 'Enter') close({ l: loginEl.value, p: pwdEl.value });
        if (e.key === 'Escape') close(null);
      };
      loginEl.onkeydown = onKey;
      pwdEl.onkeydown = onKey;
    });
  }

  async function promptLogin(){
    const creds = await showLoginModal();
    if (!creds) return;
    const [lh, ph] = await Promise.all([sha256(creds.l), sha256(creds.p)]);
    if (lh === CONFIG.loginHash && ph === CONFIG.passwordHash) {
      saveSession();
      localStorage.setItem(TOKEN_KEY, creds.p); // Сохраняем пароль для API
      location.reload();
    } else {
      alert('Неверный логин или пароль');
      promptLogin();
    }
  }

  // ---------- кнопка-замок ----------
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

  // ---------- редактор разделов (с синхронизацией) ----------
  async function setupEditors(){
    // 1. Загружаем контент с сервера
    let serverContent = {};
    try {
      const res = await fetch('/api/content');
      if (res.ok) serverContent = await res.json();
      else console.warn('Не удалось загрузить контент, статус:', res.status);
    } catch(e) {
      console.warn('Ошибка загрузки контента с сервера:', e);
    }

    // 2. Локальные правки (кэш)
    let localCache = {};
    try { localCache = JSON.parse(localStorage.getItem(PAGE_KEY) || '{}'); } catch(e){}

    // Приоритет: сервер > локальный кэш
    const merged = { ...localCache, ...serverContent };

    function getContent(section){
      const c = section.cloneNode(true);
      c.querySelectorAll('.section-tools').forEach(el => el.remove());
      return c.innerHTML;
    }
    function setContent(section, tools, html){
      tools.remove();
      section.innerHTML = html;
      section.appendChild(tools);
    }

    document.querySelectorAll('section.block').forEach(section => {
      if (!section.id) section.id = 'sec-' + Math.random().toString(36).slice(2,8);
      const id = section.id;
      const originalContent = getContent(section);

      const tools = document.createElement('div');
      tools.className = 'section-tools';
      tools.setAttribute('contenteditable','false');
      section.appendChild(tools);

      let backup = '';

      function renderNormal(){
        section.contentEditable = 'false';
        section.classList.remove('editing');
        tools.innerHTML = `<button type="button" class="edit">✏️ Редактировать</button>` + (merged[id] ? ' <button type="button" class="reset">🗑 Сбросить</button>' : '');
        tools.querySelector('.edit').addEventListener('click', startEdit);
        const r = tools.querySelector('.reset');
        if (r) r.addEventListener('click', resetEdit);
      }
      function renderEditing(){
        section.contentEditable = 'true';
        section.classList.add('editing');
        tools.innerHTML = `
          <button type="button" class="save">💾 Сохранить</button>
          <button type="button" class="cancel">↺ Отмена</button>
          <button type="button" class="reset">🗑 Сбросить</button>
        `;
        tools.querySelector('.save').addEventListener('click', saveEdit);
        tools.querySelector('.cancel').addEventListener('click', cancelEdit);
        tools.querySelector('.reset').addEventListener('click', resetEdit);
      }
      function startEdit(){ backup = getContent(section); renderEditing(); section.focus({preventScroll:true}); }

      async function saveEdit(){
        section.contentEditable = 'false';
        section.classList.remove('editing');
        const newContent = getContent(section);
        merged[id] = newContent;
        tools.innerHTML = '<span class="saved-msg">⏳ Сохраняю...</span>';
        try {
          const res = await fetch('/api/content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
            body: JSON.stringify(merged)
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          localStorage.setItem(PAGE_KEY, JSON.stringify(merged));
          renderNormal();
          flash('✓ Сохранено для всех');
        } catch(e) {
          console.error(e);
          renderNormal();
          flash('⚠ Ошибка: ' + e.message);
        }
      }
      function cancelEdit(){ setContent(section, tools, backup); renderNormal(); }
      async function resetEdit(){
        if (!confirm('Сбросить изменения этого раздела?')) return;
        delete merged[id];
        try {
          await fetch('/api/content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
            body: JSON.stringify(merged)
          });
          localStorage.setItem(PAGE_KEY, JSON.stringify(merged));
        } catch(e) {}
        setContent(section, tools, originalContent);
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

      if (merged[id]) setContent(section, tools, merged[id]);
      renderNormal();
    });
  }

  // ---------- запуск ----------
  (async function init(){
    const authorized = isSessionValid();
    if (authorized) {
      await setupEditors();
      showLockButton(true);
    } else {
      showLockButton(false);
      if (CONFIG.showWhenLocked) await setupEditors();
    }
  })();

})();
