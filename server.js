const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Tạo thư mục uploads nếu chưa có
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Middleware
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 } // 1 giờ
}));

// Cấu hình multer để lưu file nộp
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const student = req.body.student || 'unknown';
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const filename = `${student}_${base}${ext}`;
    cb(null, filename);
  }
});
const upload = multer({ storage });

// Đăng ký tài khoản
app.post('/register', (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password || !role) {
    return res.status(400).send('Thiếu thông tin.');
  }

  const users = fs.existsSync('users.json')
    ? JSON.parse(fs.readFileSync('users.json'))
    : [];

  const exists = users.find(u => u.username === username);
  if (exists) {
    return res.status(400).send('Tài khoản đã tồn tại.');
  }

  users.push({ username, email, password, role });
  fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
  res.send('Đăng ký thành công!');
});

// Đăng nhập
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const users = fs.existsSync('users.json')
    ? JSON.parse(fs.readFileSync('users.json'))
    : [];

  const user = users.find(u => u.username === username && u.password === password);
  if (user) {
    req.session.user = { username: user.username, role: user.role };
    res.send('Đăng nhập thành công');
  } else {
    res.status(401).send('Sai tài khoản hoặc mật khẩu');
  }
});

// Kiểm tra đăng nhập
app.get('/me', (req, res) => {
  if (req.session.user) {
    return res.json(req.session.user);
  }
  res.status(401).send('Chưa đăng nhập');
});

// Đăng xuất
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.send('Đã đăng xuất');
});

// Upload bài tập
app.post('/upload', upload.single('homework'), (req, res) => {
  res.send('📝 Đã nhận bài nộp thành công!');
});

// Khởi chạy server
app.listen(PORT, () => {
  console.log(`✅ Server chạy tại http://localhost:${PORT}`);
});
