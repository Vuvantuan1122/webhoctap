// Kết nối tới server Socket.IO
const socket = io("http://localhost:3000");


const messages = document.getElementById('messages');
const form = document.getElementById('form');
const input = document.getElementById('input');

// Gửi tin nhắn khi submit form
form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value) {
        socket.emit('chatMessage', input.value);
        input.value = '';
    }
});

// Lắng nghe tin nhắn chat từ server
socket.on('chatMessage', (data) => {
    const item = document.createElement('li');
    item.textContent = `${data.user}: ${data.message}`;
    messages.appendChild(item);
    window.scrollTo(0, document.body.scrollHeight);
});

// Lắng nghe thông báo từ server (vào/ra phòng)
socket.on('serverMessage', (msg) => {
    const item = document.createElement('li');
    item.textContent = msg;
    item.className = 'server-message'; // Thêm class để tạo kiểu
    messages.appendChild(item);
    window.scrollTo(0, document.body.scrollHeight);
});