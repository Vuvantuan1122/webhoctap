// ✅ Khởi tạo kết nối socket
// Nếu chạy cùng server backend (localhost hoặc Render)
const socket = io();

// Nếu frontend tách riêng (VD: GitHub Pages, còn backend ở Render) thì dùng:
// const socket = io("https://ten-backend.onrender.com");

// ------------------------
// Xử lý DOM
// ------------------------
const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');
const fileInput = document.getElementById('file-input');   // đúng id trong <input type="file" id="file-input">
const attachFileBtn = document.getElementById('attach-file');   // đúng id trong <button id="attach-file">
const attachImageBtn = document.getElementById('attach-image'); // đúng id trong <button id="attach-image">
const attachVideoBtn = document.getElementById('attach-video'); // đúng id trong <button id="attach-video">


// ------------------------
// Gửi tin nhắn text
// ------------------------
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value?.trim();
  if (!text) return;
  socket.emit('chatMessage', text);
  input.value = '';
});

// ------------------------
// Gửi file upload
// ------------------------
attachFileBtn.addEventListener('click', () => fileInput.click());
attachImageBtn.addEventListener('click', () => fileInput.click());
attachVideoBtn.addEventListener('click', () => fileInput.click());


fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    // ✅ Sử dụng window.location.origin để chạy đúng cả local lẫn deploy
    const res = await fetch(`${window.location.origin}/chat-upload`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.url) {
      socket.emit('chatMessage', data.url);
    }
  } catch (err) {
    console.error('Upload thất bại:', err);
  }
});

// ------------------------
// Nhận tin nhắn
// ------------------------
socket.on('chatMessage', (raw) => {
  const payload = (raw && typeof raw === 'object')
    ? raw
    : { user: 'Ẩn danh', message: String(raw ?? '') };

  const user = payload.user ?? 'Ẩn danh';
  const msg = String(payload.message ?? '');

  const li = document.createElement('li');
  const url = msg.split('?')[0].split('#')[0];

  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url)) {
    li.innerHTML = `<b>${user}:</b><br><img src="${msg}" style="max-width:220px;border-radius:8px">`;
  } else if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(url)) {
    li.innerHTML = `<b>${user}:</b><br><video src="${msg}" controls style="max-width:260px;border-radius:8px"></video>`;
  } else if (/^https?:\/\//i.test(msg)) {
    li.innerHTML = `<b>${user}:</b> <a href="${msg}" target="_blank">📎 Tệp đính kèm</a>`;
  } else {
    li.textContent = `${user}: ${msg}`;
  }

  messages.appendChild(li);
  window.scrollTo(0, document.body.scrollHeight);
});

// ------------------------
// Nhận thông báo từ server
// ------------------------
socket.on('serverMessage', (msg) => {
  const li = document.createElement('li');
  li.style.color = "gray";
  li.textContent = msg;
  messages.appendChild(li);
});

// Đếm số người online
socket.on('onlineCount', (n) => {
  const el = document.getElementById('onlineCount');
  if (el) el.textContent = `👥 ${n} người đang online`;
});
