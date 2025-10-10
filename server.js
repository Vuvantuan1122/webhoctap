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
const Report = require("./models/Report");
const Exam = require("./models/Exam");
const Result = require("./models/Result");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const ExitLog = require("./models/ExitLog");
// --- CHAT ---
const http = require('http');
const { Server } = require('socket.io');
const { sendVerificationEmail } = require('./utils/mailer');
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
app.use(cors({ origin: "*", credentials: true }))
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.get('/videocall', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/videocall.html'));
});
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
const nodemailer = require('nodemailer'); 

app.post('/api/send-otp', async (req, res) => {
  const { email } = req.body;

  try {
    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: "Email không hợp lệ." });
    }

    // Kiểm tra nếu email đã có user xác thực
    const existingUser = await User.findOne({ email, isVerified: true });
    if (existingUser) {
      return res.json({ message: 'Email đã được đăng ký tài khoản.' });
    }

    // Tạo mã OTP 6 chữ số
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Lưu OTP tạm thời vào file (có thể đổi sang DB sau)
    fs.writeFileSync(
      'temp-otp.json',
      JSON.stringify({ email, otpCode, time: Date.now() })
    );

    // Gửi email
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `"Xác thực tài khoản" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Mã xác thực đăng ký",
      text: `Mã xác nhận của bạn là: ${otpCode}`
    });

    console.log("✅ Đã gửi mã OTP tới:", email);
    res.json({ message: "Mã xác thực đã được gửi qua email." });
  } catch (err) {
    console.error("❌ Lỗi gửi OTP:", err);
    res.status(500).json({ message: "Lỗi máy chủ khi gửi OTP." });
  }
});

// 🧩 Xác minh OTP và tạo tài khoản thật
app.post('/api/register', async (req, res) => {
  const { username, email, password, role, school, class: cls, otp } = req.body;

  try {
    // Kiểm tra file OTP
    if (!fs.existsSync('temp-otp.json')) {
      return res.status(400).json({ message: "Chưa có mã OTP nào được gửi." });
    }

    const otpData = JSON.parse(fs.readFileSync('temp-otp.json', 'utf-8'));
    if (!otpData || otpData.email !== email || otpData.otpCode !== otp) {
      return res.status(400).json({ message: "Mã OTP không đúng." });
    }

    if (Date.now() - otpData.time > 10 * 60 * 1000) {
      return res.status(400).json({ message: "Mã OTP đã hết hạn." });
    }

    // Xoá OTP sau khi dùng
    fs.unlinkSync('temp-otp.json');

    // Kiểm tra nếu user tồn tại
    const existing = await User.findOne({ email });
    if (existing && existing.isVerified) {
      return res.status(400).json({ message: "Tài khoản đã tồn tại." });
    }

    // Tạo tài khoản thật (sau khi xác thực)
    const newUser = new User({
      username,
      email,
      password,
      role,
      school,
      class: cls,
      isVerified: true
    });

    await newUser.save();

    console.log("✅ Đã tạo tài khoản cho:", email);
    res.json({ message: "✅ Tạo tài khoản thành công!" });
  } catch (err) {
    console.error("❌ Lỗi khi tạo tài khoản:", err);
    res.status(500).json({ message: "Lỗi máy chủ khi tạo tài khoản." });
  }
});
app.post('/api/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "Không tìm thấy người dùng" });

    if (user.emailToken !== otp || Date.now() > user.emailTokenExpires) {
      return res.status(400).json({ message: "Mã OTP không đúng hoặc đã hết hạn" });
    }

    user.isVerified = true;
    user.emailToken = null;
    await user.save();

    res.json({ message: "✅ Xác thực thành công!" });
  } catch (err) {
    res.status(500).json({ message: "Lỗi máy chủ khi xác thực OTP" });
  }
});
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    // Gọi Gemini API
    const response = await fetch(
      // ✅ SỬA Ở ĐÂY: Thay 'gemini-1.5-flash' bằng 'gemini-2.5-flash'
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: message }]
            }
          ]
        })
      }
    );

    const data = await response.json();
    console.log("Gemini response:", JSON.stringify(data, null, 2));

    // Trích phản hồi
    let reply = "⚠️ Không có phản hồi từ Gemini.";

if (data?.candidates?.length > 0) {
  const parts = data.candidates[0].content?.parts;
  if (parts && parts.length > 0) {
    reply = parts.map(p => p.text || "").join("\n");
  }
}
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "⚠️ Lỗi khi gọi Gemini API." });
  }
});


// =======================
// ✅ API: Đăng nhập / Đăng xuất
// =======================
app.post('/api/login', async (req, res) => {
  const { username, password, role } = req.body;

  try {
    const user = await User.findOne({ username, password, role, isVerified: true });
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
  const subject = req.body.subject || 'Không rõ'; // 👈 NEW: Lấy môn học từ body

  const imagesFile = 'images.json';
  const images = fs.existsSync(imagesFile) ? JSON.parse(fs.readFileSync(imagesFile)) : [];

  images.push({ id: Date.now(), url: imageUrl, timestamp: Date.now(), subject: subject }); // 👈 NEW: Lưu môn học
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
  if (!admin || admin.username !== 'Vuvantuan1122') {
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
app.post("/api/reports", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ success: false, message: "Bạn phải đăng nhập" });
    }

    const { postId, reason } = req.body;
    if (!postId || !reason) {
      return res.status(400).json({ success: false, message: "Thiếu thông tin" });
    }

    const report = new Report({
      postId,
      reason,
      reporter: req.session.user.username
    });
    await report.save();

    // 🔔 Thông báo realtime cho admin
    io.emit("newReport", { 
      id: report._id,
      postId,
      reason,
      reporter: report.reporter,
      createdAt: report.createdAt
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

app.get("/api/reports", async (req, res) => {
  if (!req.session.user || req.session.user.username !== "Vuvantuan1122") {
    return res.status(403).json({ success: false, message: "Không có quyền" });
  }

  const reports = await Report.find().populate("postId").sort({ createdAt: -1 });
  res.json(reports);
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
app.post("/api/exams", async (req, res) => {
  if (!req.session.user || req.session.user.role !== "teacher") {
    return res.status(403).json({ message: "Chỉ giáo viên được tạo đề thi" });
  }
  const exam = new Exam({ ...req.body, createdBy: req.session.user.username });
  await exam.save();
  res.json({ success: true, exam });
});

// Lấy đề thi (học sinh)
app.get("/api/exams/:id", async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) return res.status(404).json({ message: "Không tìm thấy đề thi" });

  // ẩn đáp án đúng
  const safeExam = {
  _id: exam._id,
  title: exam.title,
  subject: exam.subject,
  duration: exam.duration,
  passage: exam.passage,   // 👈 thêm dòng này
  questions: exam.questions.map(q => ({
    _id: q._id,
    question: q.question,
    options: q.options,
    type: q.type
  }))
};


  res.json(safeExam);
});

// Nộp bài
// Nộp bài
app.post("/api/exams/:id/submit", async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    const { answers } = req.body;
    let correctCount = 0;
    const detailedAnswers = [];

    exam.questions.forEach((q, i) => {
      const studentAns = answers[i];

      if (q.type === "tracnghiem" || q.type === "truefalse") {
        if (studentAns !== null && parseInt(studentAns) === parseInt(q.correctAnswer)) {
          correctCount++;
        }
      }

      detailedAnswers.push({
        question: q.question,
        type: q.type,
        options: q.options,
        correctAnswer: q.correctAnswer,
        answer: studentAns
      });
    });

    // ✅ Tính điểm theo thang 10
    const totalQuestions = exam.questions.length; 
const score = totalQuestions > 0 ? (correctCount / totalQuestions) * 10 : 0;

    const result = new Result({
      examId: exam._id,
      userId: req.session.user?.username || "anonymous",
      answers: detailedAnswers,
      score: Math.round(score * 10) / 10,
      status: "graded"
    });

    await result.save();

    res.json({ message: "Nộp bài thành công", score: result.score, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Lỗi khi nộp bài" });
  }
});

app.post("/api/exams/:id/exit-log", async (req, res) => {
  try {
    const log = new ExitLog({
      examId: req.params.id,
      userId: req.session.user?.username || "unknown",
      reason: req.body.reason
    });
    await log.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Lấy lịch sử thoát cho giáo viên xem
app.get("/api/exams/:id/exit-log", async (req, res) => {
  try {
    const logs = await ExitLog.find({ examId: req.params.id }).sort({ timestamp: -1 });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// Giáo viên xem kết quả
app.get("/api/exams/:id/results", async (req, res) => {
  try {
    const examId = req.params.id;
    const results = await Result.find({ examId }).lean();
    const exam = await Exam.findById(examId).lean();

    // Gắn thêm thông tin câu hỏi để đối chiếu
    const detailedResults = results.map(r => {
      return {
        _id: r._id,
        userId: r.userId,
        score: r.score,
        answers: r.answers.map((ans, i) => {
          const q = exam.questions[i];
          return {
            type: q.type,
            question: q.question,
            options: q.options,
            answer: ans.answer,// câu trả lời của học sinh
            correctAnswer: q.correctAnswer // đáp án đúng (nếu có)
          };
        })
      };
    });

    res.json(detailedResults);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Lỗi khi lấy kết quả" });
  }
});

// Giáo viên chấm tự luận
app.post("/api/results/:id/grade", async (req, res) => {
  const { score } = req.body;
  if (!req.session.user || req.session.user.role !== "teacher") {
    return res.status(403).json({ message: "Không có quyền" });
  }
  const result = await Result.findByIdAndUpdate(req.params.id, { score, status: "graded" }, { new: true });
  res.json({ success: true, result });
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
// Lấy tất cả đề thi
app.get("/api/exams", async (req, res) => {
  try {
    const exams = await Exam.find().sort({ createdAt: -1 });
    const safeExams = exams.map(exam => ({
      _id: exam._id,
      title: exam.title,
      subject: exam.subject,
      duration: exam.duration,
      createdBy: exam.createdBy,
      createdAt: exam.createdAt
    }));
    res.json(safeExams);
  } catch (err) {
    res.status(500).json({ message: "Lỗi server", error: err.message });
  }
});
app.get("/api/results", async (req, res) => {
  try {
    const results = await Result.find()
      .populate("examId", "title subject createdAt") // lấy thêm thông tin đề thi
      .sort({ createdAt: -1 })
      .lean();

    res.json(results);
  } catch (err) {
    res.status(500).json({ message: "Lỗi khi lấy tất cả kết quả", error: err.message });
  }
});
// =======================
// ✅ SOCKET.IO CHAT
// =======================
// =======================
// ✅ SOCKET.IO CHAT
// =======================
let onlineUsers = 0;

io.on("connection", (socket) => {
  // Lấy user từ session (express-socket.io-session)
  const sessionUser = socket.handshake.session?.user;
  socket.username = sessionUser?.username || "Ẩn danh";

  onlineUsers++;
  console.log("✅ Người dùng kết nối:", socket.id, "->", socket.username);
  io.emit("serverMessage", `${socket.username} đã tham gia phòng chat`);
  io.emit("onlineCount", onlineUsers);

  // Khi client gửi tin nhắn (text hoặc object)
  socket.on("chatMessage", (payload) => {
    // Nếu client chỉ gửi chuỗi, chuyển thành object
    if (typeof payload === "string") {
      payload = { user: socket.username, message: payload };
    } else {
      // nếu client gửi object có message nhưng không có user, gán từ session
      payload.user = payload.user || socket.username;
    }

    // Phát lại cho tất cả client
    io.emit("chatMessage", payload);
  });

  // Hỗ trợ signaling cho WebRTC (videocall)
  socket.on("offer", (data) => socket.broadcast.emit("offer", { ...data, from: socket.id }));
  socket.on("answer", (data) => socket.broadcast.emit("answer", { ...data, from: socket.id }));
  socket.on("ice-candidate", (data) => socket.broadcast.emit("ice-candidate", { ...data, from: socket.id }));

  socket.on("disconnect", () => {
    onlineUsers = Math.max(0, onlineUsers - 1);
    console.log("❌ Người dùng ngắt kết nối:", socket.id, socket.username);
    io.emit("serverMessage", `${socket.username} đã rời khỏi phòng`);
    io.emit("onlineCount", onlineUsers);
  });
});




// =======================
// ✅ Khởi động server
// =======================
server.listen(PORT, () => {
  console.log(`✅ Server đang chạy tại http://localhost:${PORT}`);
});
