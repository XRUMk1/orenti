/* ======================================================
   ORENTI — редактирование с синхронизацией через Vercel Blob
   • Ключи уникальны: "имя_страницы:id_секции"
   • Контент с сервера применяется для ВСЕХ посетителей
   • Кнопки редактирования видны только после логина
   ====================================================== */
(function(){

  // ============== НАСТРОЙКИ ==============
  const CONFIG = {
    loginHash:    "9313181f777104d96a4034374e26f0a6fc2af94a1b6d3f9db97067af6f85b11d",
    passwordHash: "94c69adfda279ab3f7c3dd90a9f59e4f06471f2344719c93f5e96c314af91fb6",
    sessionHours: 72,
    showWhenLocked: false
  };
  // ============ / НАСТРОЙКИ ==============

  const AUTH_KEY  = 'orenti-auth-until';
  const TOKEN_KEY = 'orenti-edit-token';
  const API_URL   = '/api/content';

  // Уникальный слаг страницы: "moderators", "ga-zga", "support", "index"
  const PAGE_SLUG = (function(){
    const file = (location.pathname.split('/').pop() || 'index.html').split('?')[0];
    return file.replace(/\.html?$/i, '') || 'index';
  })();

  function pageKey(id){ return PAGE_SLUG + ':' + id; }

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
    document.querySelectorAll('section.block').forEach((section, idx) => {
      const id = section.id || ('sec-' + idx);
      const key = pageKey(id);
      const html = serverContent[key];
      if (html == null) return;
      section.querySelectorAll('.section-tools').forEach(el => el.remove());
      section.innerHTML = html;
    });
  }

  async function loadServerContent(){
    try {
      const res = await fetch(API_URL + '?t=' + Date.now(), { cache: 'no-store' });
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
  // ЧАСТЬ 2. Авторизация
  // =====================================================
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

  // =====================================================
  // ЧАСТЬ 3. Редактор — только для админа
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
      }

      function startEdit(){
        backup = getCleanContent(section);
        renderEditing();
        section.focus({ preventScroll: true });
      }

      async function saveEdit(){
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

  // =====================================================
  // Запуск
  // =====================================================
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
