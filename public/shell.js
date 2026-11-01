/* Khung giao diện dùng chung (header + sidebar cố định) – đồng bộ với trang chính.
   Cách dùng: <body data-active="homework"> <main>…</main> <script src="shell.js"></script> */
(function () {
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || d); } catch { return JSON.parse(d); } };
  const userData = read('userData', '{}');
  const role = userData.role === 'teacher' ? 'teacher' : 'student';
  const active = document.body.dataset.active || '';

  const NAV = {
    student: [
      ['homework', 'baitapvn.html', 'bxs-book-content', 'Bài Tập Về Nhà'],
      ['lecture', 'bai giang.html', 'bxs-videos', 'Bài Giảng'],
      ['forum', 'forum.html', 'bxs-help-circle', 'Góc Hỏi Đáp'],
      ['exams', 'exams.html', 'bxs-edit-alt', 'Kiểm tra'],
      ['bank', 'nganhangcauhoi.html', 'bxs-book-content', 'Ngân hàng câu hỏi'],
      ['chat', 'chat.html', 'bxs-message-dots', 'Trò chuyện']
    ],
    teacher: [
      ['homework', 'bai tap.html', 'bxs-book-content', 'Bài Tập Về Nhà'],
      ['lecture', 'bai giang.html', 'bxs-videos', 'Bài Giảng'],
      ['forum', 'forum.html', 'bxs-help-circle', 'Góc Hỏi Đáp'],
      ['bank', 'nganhangcauhoi.html', 'bxs-book-content', 'Ngân hàng câu hỏi'],
      ['exams', 'teacher.html', 'bxs-edit-alt', 'Kiểm tra'],
      ['chat', 'chat.html', 'bxs-message-dots', 'Trò chuyện']
    ]
  };
  const TOOLS = role === 'teacher'
    ? [['classes', 'teacher-classes.html', 'bx-book-open', 'Quản lý lớp'], ['about', 'contact.html', 'bx-wrench', 'Giới thiệu']]
    : [['classes', 'student-classes.html', 'bx-school', 'Lớp học'], ['about', 'contact.html', 'bx-wrench', 'Giới thiệu']];
  const home = role === 'teacher' ? 'giaovien.html' : 'index.html';

  const DEFAULT_AVATAR = "data:image/svg+xml;utf8," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='#2d3038'/>" +
    "<circle cx='32' cy='24' r='11' fill='#8a94a6'/><path d='M10 58c2-13 12-19 22-19s20 6 22 19z' fill='#8a94a6'/></svg>");

  const main = document.querySelector('main');
  const pc = document.createElement('div');
  pc.className = 'page-container';
  pc.innerHTML = `
    <header class="header">
      <div class="header-left">
        <i class='bx bx-menu menu-toggle' id="menu-toggle"></i>
        <a href="${home}" class="logo"><img src="5.jpg" alt="Icon"><span>NT Education</span></a>
      </div>
      <div class="user-profile">
        ${TOOLS.map(t => `<a href="${t[1]}" class="tool-box ${active === t[0] ? 'active' : ''}"><i class='bx ${t[2]}'></i><span>${t[3]}</span></a>`).join('')}
        <img id="avatar" src="${DEFAULT_AVATAR}" alt="Avatar" />
      </div>
    </header>
    <aside class="sidebar" id="sidebar">
      <nav class="sidebar-menu">
        ${NAV[role].map(n => `<a href="${n[1]}" class="${active === n[0] ? 'active' : ''}"><i class='bx ${n[2]}'></i> <span>${n[3]}</span></a>`).join('')}
      </nav>
    </aside>`;
  document.body.insertBefore(pc, main);
  pc.appendChild(main);

  const $ = id => document.getElementById(id);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'modal-overlay';
  document.body.appendChild(overlay);
  const sidebar = $('sidebar');
  $('menu-toggle').onclick = () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); };
  overlay.onclick = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };

  // Menu tài khoản ở ảnh đại diện: hồ sơ, ảnh đại diện, đăng xuất
  const am = document.createElement('script');
  am.src = 'account-menu.js';
  document.body.appendChild(am);

  window.Shell = { role, userData, esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) };
})();
