require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
// --- CHAT ---: Thêm 2 thư viện http và socket.io
const http = require('http');
const { Server } = require('socket.io');

const User = require('./models/user');
const Student = require('./models/student');

const app = express();
// --- CHAT ---: Tạo server http từ app của Express
const server = http.createServer(app);
// --- CHAT ---: Khởi tạo socket.io
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://webhoctap-fixq.onrender.com"], // Thêm URL frontend của bạn
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// ✅ Tạo thư mục uploads nếu chưa có
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// ✅ Kết nối MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Kết nối MongoDB thành công!'))
  .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// ✅ Session setup
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

// ✅ Middleware
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ✅ Multer setup
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Cấu hình Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'bai_tap_hoc_sinh',
    allowed_formats: ['jpg', 'png', 'jpeg']
  }
});
const upload = multer({ storage });

// =======================
// ✅ API: Đăng ký tài khoản
// =======================
app.post('/api/register', async (req, res) => {
  const { username, email, password, role, school, class: userClass } = req.body;
  if (!username || !email || !password || !role) {
    return res.status(400).json({ message: 'Thiếu thông tin.' });
  }

  try {
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ message: 'Tài khoản đã tồn tại.' });

    const newUser = new User({ username, email, password, role, school, class: userClass });
    await newUser.save();

    res.json({ message: 'Đăng ký thành công!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});

// =======================
// ✅ API: Đăng nhập / Đăng xuất
// =======================
app.post('/api/login', async (req, res) => {
  const { username, password, role } = req.body;

  try {
    const user = await User.findOne({ username, password, role });
    if (!user) return res.status(401).json({ message: 'Sai tài khoản hoặc mật khẩu.' });

    req.session.user = { username: user.username, role: user.role };
    res.json({ message: 'Đăng nhập thành công', username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ success: false });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

app.get('/me', (req, res) => {
  if (req.session.user) {
    return res.json(req.session.user);
  }
  res.status(401).json({ message: 'Chưa đăng nhập' });
});

// =======================
// ✅ API: Upload ảnh bài tập
// =======================
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Chưa có ảnh nào được gửi lên' });

  const imageUrl = req.file.path; // link CDN vĩnh viễn

  const imagesFile = 'images.json';
  const images = fs.existsSync(imagesFile) ? JSON.parse(fs.readFileSync(imagesFile)) : [];

  images.push({ id: Date.now(), url: imageUrl, timestamp: Date.now() });
  fs.writeFileSync(imagesFile, JSON.stringify(images, null, 2));

  res.json({ message: 'Tải lên thành công', imageUrl });
});
app.get('/api/images', (req, res) => {
  const images = fs.existsSync('images.json') ? JSON.parse(fs.readFileSync('images.json')) : [];
  res.json(images);
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

// =======================
// ✅ API: Quản lý tài khoản (admin)
// =======================
app.get('/api/users', async (req, res) => {
  const user = req.session.user;
  if (!user || user.username !== 'Vuvantaun1122') {
    return res.status(403).json({ message: 'Không có quyền truy cập' });
  }

  try {
    const users = await User.find({}, '-password'); // ẩn mật khẩu
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi máy chủ' });
  }
});

// =======================
// ✅ API: Quản lý học sinh
// =======================
app.post('/api/students', async (req, res) => {
  try {
    const { username, fullname, class: studentClass, dob, scores } = req.body;
    const existing = await Student.findOne({ username });
    if (existing) return res.status(400).json({ message: 'Học sinh đã tồn tại.' });

    const student = new Student({ username, fullname, class: studentClass, dob, scores });
    await student.save();
    res.json({ message: 'Đã thêm học sinh.' });
  } catch (err) {
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
    res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});

app.delete('/api/students/:id', async (req, res) => {
  try {
    await Student.findByIdAndDelete(req.params.id);
    res.json({ message: 'Đã xoá học sinh.' });
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

io.on('connection', (socket) => {
    console.log('✅ Một người dùng đã kết nối vào chat');

    // Tạo một tên ẩn danh ngẫu nhiên cho người dùng
    const anonymousName = `Người Dùng #${Math.floor(Math.random() * 1000)}`;

    // Gửi thông báo cho client là họ đã vào phòng
    socket.emit('serverMessage', `Chào mừng bạn! Tên ẩn danh của bạn là: ${anonymousName}`);
    
    // Gửi thông báo cho các client khác là có người mới vào
    socket.broadcast.emit('serverMessage', `${anonymousName} đã tham gia cuộc trò chuyện.`);

    // Lắng nghe sự kiện 'chatMessage' từ client
    socket.on('chatMessage', (msg) => {
        // Gửi tin nhắn đến tất cả mọi người (bao gồm cả người gửi)
        io.emit('chatMessage', { user: anonymousName, message: msg });
    });

    // Khi client ngắt kết nối
    socket.on('disconnect', () => {
        console.log('❌ Người dùng đã ngắt kết nối');
        io.emit('serverMessage', `${anonymousName} đã rời khỏi cuộc trò chuyện.`);
    });
});

// =======================
// ✅ Khởi động server
// =======================
// --- CHAT ---: Thay app.listen bằng server.listen
server.listen(PORT, () => {
  console.log(`✅ Server đang chạy tại http://localhost:${PORT}`);
});
