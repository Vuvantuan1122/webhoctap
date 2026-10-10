// Khởi tạo kết nối socket (cùng server backend)
const socket = io();

const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');
const fileInput = document.getElementById('file-input');
const attachFileBtn = document.getElementById('attach-file');
const attachImageBtn = document.getElementById('attach-image');
const attachVideoBtn = document.getElementById('attach-video');
const esc = (window.Shell && Shell.esc) || (s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

// Tên người dùng hiện tại (để căn tin nhắn của mình sang phải)
let myName = (window.Shell && Shell.userData && Shell.userData.username) || null;
fetch('/me').then(r => r.ok ? r.json() : null).then(u => { if (u && u.username) myName = u.username; }).catch(() => {});

function pushItem(li) {
  const empty = document.getElementById('chat-empty');
  if (empty) empty.remove();
  messages.appendChild(li);
  messages.scrollTop = messages.scrollHeight;
}

// Gửi tin nhắn text
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value?.trim();
  if (!text) return;
  socket.emit('chatMessage', text);
  input.value = '';
});

// Gửi file upload
attachFileBtn.addEventListener('click', () => fileInput.click());
attachImageBtn.addEventListener('click', () => fileInput.click());
attachVideoBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`${window.location.origin}/chat-upload`, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.url) socket.emit('chatMessage', data.url);
  } catch (err) {
    console.error('Upload thất bại:', err);
  }
  fileInput.value = '';
});

// Nhận tin nhắn
socket.on('chatMessage', (raw) => {
  const payload = (raw && typeof raw === 'object') ? raw : { user: 'Ẩn danh', message: String(raw ?? '') };
  const user = payload.user ?? 'Ẩn danh';
  const msg = String(payload.message ?? '');
  const url = msg.split('?')[0].split('#')[0];
  const safe = esc(msg);

  let body;
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url) && /^https?:\/\//i.test(msg)) {
    body = `<a href="${safe}" target="_blank" rel="noopener"><img src="${safe}" alt="Hình ảnh"></a>`;
  } else if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(url) && /^https?:\/\//i.test(msg)) {
    body = `<video src="${safe}" controls></video>`;
  } else if (/^https?:\/\//i.test(msg)) {
    body = `<a href="${safe}" target="_blank" rel="noopener">📎 Tệp đính kèm</a>`;
  } else {
    body = safe;
  }

  const li = document.createElement('li');
  li.className = 'msg' + (myName && user === myName ? ' mine' : '');
  li.innerHTML = `<span class="who">${esc(user)}</span><div class="bubble">${body}</div>`;
  pushItem(li);
});

// Thông báo từ server
socket.on('serverMessage', (msg) => {
  const li = document.createElement('li');
  li.className = 'sys';
  li.textContent = msg;
  pushItem(li);
});

// Đếm số người online
socket.on('onlineCount', (n) => {
  const el = document.getElementById('online-users');
  if (el) el.textContent = n;
});
