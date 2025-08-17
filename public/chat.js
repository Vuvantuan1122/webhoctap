const socket = io(window.location.origin);
async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`${window.location.origin}/chat-upload`, {
      method: 'POST',
      body: formData
    });
    return await res.json();
  } catch (err) {
    console.error('Upload thất bại:', err);
    return null;
  }
}
const messages = document.getElementById('messages');
const form = document.getElementById('form');
const input = document.getElementById('input');
const fileInput = document.getElementById('file-input');

// =======================
// Gửi tin nhắn text
// =======================
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value?.trim();
  if (!text) return;
  socket.emit('chatMessage', text);
  input.value = '';
});

// =======================
// Upload file (ảnh, video, pdf...)
// =======================
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('http://localhost:3000/chat-upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (data?.url) {
      socket.emit('chatMessage', data.url); // gửi link Cloudinary
    } else {
      console.error('Upload lỗi:', data);
    }
  } catch (err) {
    console.error('Upload thất bại:', err);
  }

  fileInput.value = ""; // reset input sau khi gửi
});

// =======================
// Nhận tin nhắn
// =======================
socket.on('chatMessage', (raw) => {
  const payload = (raw && typeof raw === 'object') ? raw : { user: 'Ẩn danh', message: String(raw ?? '') };
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

// =======================
// Nhận thông báo hệ thống
// =======================
socket.on('serverMessage', (msg) => {
  const li = document.createElement('li');
  li.textContent = msg;
  li.className = 'server-message';
  messages.appendChild(li);
  window.scrollTo(0, document.body.scrollHeight);
});
