require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const Post = require("./models/Post");
const Comment = require("./models/Comment");
// --- CHAT ---
const http = require('http');
const { Server } = require('socket.io');

const User = require('./models/user');
const Student = require('./models/student');

const app = express();
const server = http.createServer(app);
app.set('trust proxy', true);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// ✅ Tạo thư mục uploads local
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('uploads/chat')) fs.mkdirSync('uploads/chat');
if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads');

// ✅ Kết nối MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Kết nối MongoDB thành công!'))
  .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// ✅ Session setup
const sharedsession = require("express-socket.io-session");

const sessionMiddleware = session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
});

app.use(sessionMiddleware);
io.use(sharedsession(sessionMiddleware, { autoSave:true }));
// ✅ Middleware
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// ✅ Cloudinary cấu hình
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET
});

// ==== Upload bài tập (Cloudinary) ====
const baiTapStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "bai_tap_hoc_sinh",
    allowed_formats: ["jpg", "png", "jpeg"]
  }
});
const baiTapUpload = multer({ storage: baiTapStorage });

// ==== Upload chat (Cloudinary) ====
const chatStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "chat_uploads",
    resource_type: "auto"
  }
});
const chatUpload = multer({ storage: chatStorage });

// ==== Upload forum (Local) ====
const forumUpload = multer({
  storage: multer.diskStorage({
    destination: "public/uploads/",
    filename: (req, file, cb) => {
      cb(null, Date.now() + path.extname(file.originalname));
    },
  }),
});

// ==== Upload comment (Cloudinary) ====
const commentStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "comment_uploads",
    allowed_formats: ["jpg", "png", "jpeg", "gif"]
  }
});
const commentUpload = multer({ storage: commentStorage });
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
}

// 📌 Load posts từ file
function loadPosts() {
  return JSON.parse(fs.readFileSync('posts.json', 'utf-8'));
}
function savePosts(posts) {
  fs.writeFileSync('posts.json', JSON.stringify(posts, null, 2));
}

// ✅ Tạo bài đăng
app.post("/api/posts", forumUpload.single("image"), async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: "Bạn phải đăng nhập để đăng bài" });
  }

  if (!req.file) {
    return res.status(400).json({ message: "Chưa có ảnh" });
  }

  const post = new Post({
    author: req.session.user.username,  // ✅ luôn dùng tên tài khoản
    caption: req.body.caption,
    imageUrl: "/uploads/" + req.file.filename,
  });

  await post.save();
  res.json(post);
});
// ✅ Lấy danh sách bài đăng
app.get("/api/posts", async (req, res) => {
  const posts = await Post.find().sort({ createdAt: -1 });
  res.json(posts);
});

// ✅ Thêm bình luận (có thể kèm ảnh - Cloudinary)
app.post("/api/posts/:id/comments", commentUpload.single("image"), async (req, res) => {
  const comment = new Comment({
    postId: req.params.id,
    author: req.session?.user?.username || "Ẩn danh",
    content: req.body.content,
    imageUrl: req.file ? req.file.path : null   // URL Cloudinary
  });
  await comment.save();
  res.json(comment);
});

// ✅ Lấy bình luận
app.get("/api/posts/:id/comments", async (req, res) => {
  const comments = await Comment.find({ postId: req.params.id }).sort({ createdAt: 1 });
  res.json(comments);
});

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

    // 📌 Lưu session
    req.session.user = { username: user.username, role: user.role };

    // 📌 Lưu IP vào lịch sử đăng nhập
    const ip = getClientIp(req);
    user.loginHistory = user.loginHistory || [];
    user.loginHistory.push({ ip });
    await user.save();

    res.json({ message: 'Đăng nhập thành công', username: user.username, role: user.role });
  } catch (err) {
    console.error(err);
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
// ✅ API: Upload ảnh bài tập (Cloudinary)
// =======================
app.post('/upload', baiTapUpload.single('image'), (req, res) => {
  if (!req.file || !req.file.path) return res.status(400).json({ message: 'Chưa có ảnh nào được gửi lên' });

  const imageUrl = req.file.path;

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
  let images = fs.existsSync('images.json') ? JSON.parse(fs.readFileSync('images.json')) : [];
  images = images.filter(img => !img.url.includes(filename));
  fs.writeFileSync('images.json', JSON.stringify(images, null, 2));
  res.json({ success: true });
});

// =======================
// ✅ API: Quản lý tài khoản (admin)
// =======================
app.get('/api/users', async (req, res) => {
  const user = req.session.user;
  if (!user || user.username !== 'Vuvantuan1122') {
    return res.status(403).json({ message: 'Không có quyền truy cập' });
  }

  try {
    const users = await User.find({}, '-password').lean();

    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi máy chủ' });
  }
});
app.get('/api/admin/login-ips', async (req, res) => {
  const admin = req.session.user;
  if (!admin || admin.username !== 'Vuvantaun1122') {
    return res.status(403).json({ message: 'Không có quyền truy cập' });
  }

  const users = await User.find({}, 'username loginHistory');
  res.json(users);
});

// ✅ Xoá bài (chỉ admin mới được xoá)
app.delete("/api/posts/:id", async (req, res) => {
  const user = req.session.user;
  if (!user || user.username !== "Vuvantuan1122") {
    return res.status(403).json({ message: "Không có quyền xoá bài" });
  }

  try {
    await Post.findByIdAndDelete(req.params.id);
    await Comment.deleteMany({ postId: req.params.id }); // xoá luôn comment
    res.json({ success: true, message: "Đã xoá bài" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Lỗi server" });
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

// =======================
// ✅ API: Upload file chat (ảnh/tệp/video - Cloudinary)
// =======================
app.post('/chat-upload', chatUpload.single('file'), (req, res) => {
  if (!req.file || !req.file.path) {
    return res.status(400).json({ error: "Upload thất bại" });
  }
  res.json({ url: req.file.path }); // Cloudinary trả về URL
});

// =======================
// ✅ SOCKET.IO CHAT
// =======================
let onlineUsers = 0;

io.on('connection', (socket) => {
  console.log('✅ Một người dùng đã kết nối vào chat');
  onlineUsers++;
  io.emit('onlineUsers', onlineUsers);

  // ✅ Nếu có session user thì lấy username, không thì đặt ẩn danh
  const username = socket.request.session?.user?.username || `Người Dùng #${Math.floor(Math.random() * 1000)}`;

  socket.emit('serverMessage', `Chào mừng ${username}!`);
  socket.broadcast.emit('serverMessage', `${username} đã tham gia cuộc trò chuyện.`);

  socket.on('chatMessage', (msg) => {
    io.emit('chatMessage', { user: username, message: msg });
  });

  socket.on('disconnect', () => {
    console.log('❌ Người dùng đã ngắt kết nối');
    onlineUsers--;
    io.emit('onlineUsers', onlineUsers);
    io.emit('serverMessage', `${username} đã rời khỏi cuộc trò chuyện.`);
  });
});

// =======================
// ✅ Khởi động server
// =======================
server.listen(PORT, () => {
  console.log(`✅ Server đang chạy tại http://localhost:${PORT}`);
});
