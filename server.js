require('dotenv').config();
const Student = require('./models/student');

const mongoose = require('mongoose');
const User = require('./models/user');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');

const app = express(); // ✅ Đảm bảo khai báo app trước


const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Kết nối MongoDB thành công!'))
  .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));
// Session setup
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));


// Multer for uploads
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
function readUsers() {
  return fs.existsSync('users.json') 
    ? JSON.parse(fs.readFileSync('users.json')) 
    : [];
}
// Register
app.post('/api/register', async (req, res) => {
  const { username, email, password, role, school, class: userClass } = req.body;

  if (!username || !email || !password || !role) {
    return res.status(400).json({ message: 'Thiếu thông tin.' });
  }

  try {
    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(400).json({ message: 'Tài khoản đã tồn tại.' });
    }

    const newUser = new User({ username, email, password, role, school, class: userClass });
    await newUser.save();

    res.json({ message: 'Đăng ký thành công!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password, role } = req.body;

  try {
    const user = await User.findOne({ username, password, role });
    if (!user) {
      return res.status(401).json({ message: 'Sai tài khoản hoặc mật khẩu.' });
    }

    req.session.user = { username: user.username, role: user.role };

    res.json({
      message: 'Đăng nhập thành công',
      username: user.username,
      role: user.role
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ success: false });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// Kiểm tra phiên
app.get('/me', (req, res) => {
  if (req.session.user) {
    return res.json(req.session.user);
  }
  res.status(401).json({ message: 'Chưa đăng nhập' });
});

// Upload bài
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Chưa có ảnh nào được gửi lên' });

  const imageUrl = `/uploads/${req.file.filename}`;

  const imagesFile = 'images.json';
  const images = fs.existsSync(imagesFile) ? JSON.parse(fs.readFileSync(imagesFile)) : [];

  images.push({ id: Date.now(), url: imageUrl, timestamp: Date.now() });
  app.get('/api/images', (req, res) => {
  const images = fs.existsSync('images.json') ? JSON.parse(fs.readFileSync('images.json')) : [];
  res.json(images);
});



  fs.writeFileSync(imagesFile, JSON.stringify(images, null, 2));
  res.json({ message: 'Tải lên thành công', imageUrl });
});
app.get('/api/images', (req, res) => {
  const images = fs.existsSync('images.json') ? JSON.parse(fs.readFileSync('images.json')) : [];
  res.json(images);
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server đang chạy tại cổng: ${PORT}`);
});
app.delete('/api/images/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'uploads', filename);

  fs.unlink(filePath, (err) => {
    if (err) return res.status(500).json({ success: false });

    let images = fs.existsSync('images.json') ? JSON.parse(fs.readFileSync('images.json')) : [];
    images = images.filter(img => !img.url.includes(filename));
    fs.writeFileSync('images.json', JSON.stringify(images, null, 2));

    res.json({ success: true });
  });
});
app.get('/api/users', async (req, res) => {
  const user = req.session.user;
  if (!user || user.username !== 'Vuvantaun1122') {
    return res.status(403).json({ message: 'Không có quyền truy cập' });
  }

  try {
    const users = await User.find({}, '-password'); // bỏ mật khẩu
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Lỗi máy chủ' });
  }
});
app.post('/api/students', async (req, res) => {
  try {
    const { username, fullname, class: studentClass, dob, scores } = req.body;
    const existing = await Student.findOne({ username });
    if (existing) return res.status(400).json({ message: 'Học sinh đã tồn tại.' });

    const student = new Student({ username, fullname, class: studentClass, dob, scores });
    await student.save();
    res.json({ message: 'Đã thêm học sinh.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});
app.get('/api/students', async (req, res) => {
  try {
    const className = req.query.class;
    const students = className
      ? await Student.find({ class: className })
      : await Student.find();

    res.json(students);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});
app.delete('/api/students/:id', async (req, res) => {
  try {
    await Student.findByIdAndDelete(req.params.id);
    res.json({ message: 'Đã xóa học sinh.' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});
app.put('/api/students/:id/scores', async (req, res) => {
  try {
    const { scores } = req.body;
    await Student.findByIdAndUpdate(req.params.id, { scores });
    res.json({ message: 'Đã cập nhật điểm.' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});