/* Menu tài khoản dùng chung – bấm vào ảnh đại diện ở góc phải trên cùng:
   Xem hồ sơ · Xem/Đổi/Xoá ảnh đại diện · Đăng xuất.
   Cách dùng: <script src="account-menu.js"></script> ở cuối <body>.
   - Trang đã có ảnh #avatar (hoặc .user-profile img) → dùng luôn.
   - Trang có <header> nhưng chưa có ảnh → thêm ảnh vào cuối header.
   - Trang không có header → thêm nút avatar nổi ở góc phải trên. */
(function () {
  if (window.__acctMenu) return;
  window.__acctMenu = true;

  const DEF_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='#2d3038'/>" +
    "<circle cx='32' cy='24' r='11' fill='#8a94a6'/><path d='M10 58c2-13 12-19 22-19s20 6 22 19z' fill='#8a94a6'/></svg>");

  let me = {};
  try { me = JSON.parse(localStorage.getItem('userData') || '{}') || {}; } catch (_) {}
  const home = me.role === 'teacher' ? 'giaovien.html' : 'index.html';
  const roleLabel = me.role === 'teacher' ? 'Giáo viên' : 'Học sinh';
  const displayName = me.fullName || me.name || me.username || 'Tài khoản';

  const ICON = {
    profile: '<path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm4 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-3 8h6c0-2-1.3-3-3-3s-3 1-3 3zm9-7v1.5h5V10h-5zm0 3.5V15h5v-1.5h-5z"/>',
    view: '<path d="M12 5C6.5 5 2.7 9.2 1.5 12c1.2 2.8 5 7 10.5 7s9.3-4.2 10.5-7C21.3 9.2 17.5 5 12 5zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/>',
    change: '<path d="M4 5h3l1.5-2h7L17 5h3a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z"/>',
    del: '<path d="M9 3h6l1 2h4v2H4V5h4l1-2zM5 9h14l-1 12H6L5 9z"/>',
    out: '<path d="M4 3h9a1 1 0 0 1 1 1v3h-2V5H6v14h6v-2h2v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm13 5 5 4-5 4v-3h-7v-2h7V8z"/>'
  };
  const svg = k => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">${ICON[k]}</svg>`;

  const css = document.createElement('style');
  css.textContent = `
    .acct-av { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid #3a7bfd; cursor: pointer; background: #2d3038; flex-shrink: 0; transition: transform .2s; }
    .acct-av:hover { transform: scale(1.08); }
    .acct-float { position: fixed; top: 12px; right: 16px; z-index: 900; box-shadow: 0 6px 18px rgba(0,0,0,.45); }
    #acctMenu { position: fixed; z-index: 3000; width: 270px; max-width: calc(100vw - 20px); padding: 8px; border-radius: 16px; display: none;
      background: rgba(30,32,38,.97); backdrop-filter: blur(14px); border: 1px solid rgba(255,255,255,.12); box-shadow: 0 16px 40px rgba(0,0,0,.55);
      font-family: 'Poppins', system-ui, sans-serif; color: #f0f2f5; }
    #acctMenu.on { display: block; animation: acctIn .16s ease-out; }
    @keyframes acctIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
    #acctMenu .am-head { display: flex; align-items: center; gap: 12px; padding: 10px 10px 12px; }
    #acctMenu .am-head img { width: 46px; height: 46px; border-radius: 50%; object-fit: cover; border: 2px solid #3a7bfd; background: #2d3038; }
    #acctMenu .am-head b { display: block; font-size: .95rem; font-weight: 600; line-height: 1.25; word-break: break-word; }
    #acctMenu .am-head small { display: inline-block; margin-top: 3px; padding: 1px 9px; border-radius: 999px; font-size: .68rem; font-weight: 600; color: #9cc0ff; background: rgba(58,123,253,.18); border: 1px solid rgba(58,123,253,.4); }
    #acctMenu .am-sep { height: 1px; margin: 6px 4px; background: rgba(255,255,255,.1); }
    #acctMenu button { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 0; border-radius: 10px; background: none; color: #c9d1dc; font: 500 .88rem 'Poppins', system-ui, sans-serif; text-align: left; cursor: pointer; transition: background .15s, color .15s; }
    #acctMenu button:hover { background: #3a7bfd; color: #fff; }
    #acctMenu button.danger { color: #ff9a9a; }
    #acctMenu button.danger:hover { background: #ff5b5b; color: #fff; }
    #acctViewer { position: fixed; inset: 0; z-index: 3100; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 18px; background: rgba(0,0,0,.78); padding: 20px; }
    #acctViewer.on { display: flex; }
    #acctViewer img { max-width: 86vw; max-height: 74vh; border-radius: 12px; object-fit: contain; background: #2d3038; }
    #acctViewer button { padding: 10px 28px; border-radius: 10px; border: 1px solid rgba(255,255,255,.2); background: rgba(45,48,56,.95); color: #fff; font: 600 .9rem 'Poppins', system-ui, sans-serif; cursor: pointer; }
    #acctViewer button:hover { background: #ff5b5b; }
  `;
  document.head.appendChild(css);

  /* ---------- Tìm / tạo ảnh avatar ---------- */
  let av = document.getElementById('avatar') || document.querySelector('.user-profile img');
  if (!av) {
    av = document.createElement('img');
    av.id = 'avatar'; av.alt = 'Avatar'; av.className = 'acct-av';
    const header = document.querySelector('body > header, header.header, header.topbar, .page-container > header');
    if (header) header.appendChild(av);
    else { av.classList.add('acct-float'); document.body.appendChild(av); }
  }
  av.setAttribute('role', 'button'); av.setAttribute('aria-haspopup', 'menu'); av.title = 'Tài khoản';

  const saved = () => { try { return localStorage.getItem('userAvatar'); } catch (_) { return null; } };
  const setAvatar = src => {
    av.src = src || DEF_AVATAR;
    const mav = document.getElementById('acctMenuAv'); if (mav) mav.src = av.src;
  };
  av.onerror = () => { if (av.src !== DEF_AVATAR) av.src = DEF_AVATAR; };   // ảnh mặc định cũ (default-avatar.png) không tồn tại
  setAvatar(saved());

  /* ---------- Menu + trình xem ảnh ---------- */
  const menu = document.createElement('div');
  menu.id = 'acctMenu'; menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div class="am-head"><img id="acctMenuAv" alt=""><div><b id="acctName"></b><small>${roleLabel}</small></div></div>
    <button data-a="profile" role="menuitem">${svg('profile')} Xem hồ sơ của tôi</button>
    <div class="am-sep"></div>
    <button data-a="view" role="menuitem">${svg('view')} Xem ảnh đại diện</button>
    <button data-a="change" role="menuitem">${svg('change')} Đổi ảnh đại diện</button>
    <button data-a="del" role="menuitem">${svg('del')} Xoá ảnh đại diện</button>
    <div class="am-sep"></div>
    <button data-a="logout" class="danger" role="menuitem">${svg('out')} Đăng xuất</button>`;
  document.body.appendChild(menu);
  menu.querySelector('#acctName').textContent = displayName;
  menu.querySelector('#acctMenuAv').src = av.src;

  const file = document.createElement('input');
  file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
  document.body.appendChild(file);

  const viewer = document.createElement('div');
  viewer.id = 'acctViewer';
  viewer.innerHTML = '<img alt="Ảnh đại diện lớn"><button type="button">Đóng</button>';
  document.body.appendChild(viewer);

  function place() {
    const r = av.getBoundingClientRect();
    menu.style.top = Math.round(r.bottom + 10) + 'px';
    menu.style.right = Math.max(10, Math.round(innerWidth - r.right)) + 'px';
  }
  const open = () => { place(); menu.classList.add('on'); };
  const close = () => menu.classList.remove('on');

  av.addEventListener('click', e => { e.stopPropagation(); menu.classList.contains('on') ? close() : open(); });
  document.addEventListener('click', e => { if (!menu.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); viewer.classList.remove('on'); } });
  addEventListener('resize', () => menu.classList.contains('on') && place());
  addEventListener('scroll', close, { passive: true });

  viewer.addEventListener('click', e => { if (e.target === viewer || e.target.tagName === 'BUTTON') viewer.classList.remove('on'); });

  file.addEventListener('change', () => {
    const f = file.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try { localStorage.setItem('userAvatar', rd.result); setAvatar(rd.result); }
      catch (_) { alert('Ảnh quá lớn, vui lòng chọn ảnh nhỏ hơn.'); }
    };
    rd.readAsDataURL(f);
    file.value = '';
  });

  menu.addEventListener('click', async e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const a = b.dataset.a;
    close();
    if (a === 'profile') location.href = 'profile.html';
    else if (a === 'view') { viewer.querySelector('img').src = av.src; viewer.classList.add('on'); }
    else if (a === 'change') file.click();
    else if (a === 'del') { try { localStorage.removeItem('userAvatar'); } catch (_) {} setAvatar(null); }
    else if (a === 'logout') {
      try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); } catch (_) {}
      try { localStorage.removeItem('isLoggedIn'); localStorage.removeItem('userData'); } catch (_) {}
      location.href = '1.html';
    }
  });

  window.AccountMenu = { home };
})();
