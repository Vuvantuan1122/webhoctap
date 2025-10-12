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
// ✅ CLASSROOM MODEL MỚI
const Classroom = require("./models/Classroom"); 
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

    // ✅ FIX: Tạo Student document nếu role là 'student' – THÊM id nếu schema required
    if (role === 'student') {
      try {
        const newStudent = new Student({
          id: username,  // ✅ FIX: Set id = username (string, hoặc new mongoose.Types.ObjectId().toString() nếu schema ObjectId)
          username: username,
          school: school,
          class: cls
        });
        await newStudent.save();
        console.log('✅ Đã tạo Student document cho:', username);
      } catch (studentErr) {
        console.error('Lỗi tạo Student (không ảnh hưởng User):', studentErr);
        // Không throw, chỉ log – User vẫn ok
      }
    }

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

// ✅ THÊM MỚI: API Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ message: 'Vui lòng nhập đầy đủ tài khoản và mật khẩu.' });
  }

  try {
    // Tìm user theo username và password (plain text - khuyến nghị dùng bcrypt sau)
    const user = await User.findOne({ username, password });
    if (!user || !user.isVerified) {
      return res.status(401).json({ message: 'Tài khoản hoặc mật khẩu không đúng.' });
    }

    // Set session
    req.session.user = {
      _id: user._id,
      username: user.username,
      role: user.role,
      email: user.email
    };

    console.log(`✅ Đăng nhập thành công: ${username}`);
    res.json({ 
      message: 'Đăng nhập thành công!', 
      user: { username: user.username, role: user.role } 
    });
  } catch (err) {
    console.error('Lỗi login:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi đăng nhập.' });
  }
});

// ✅ THÊM MỚI: API Logout
app.post('/api/logout', (req, res) => {
  if (req.session.user) {
    console.log(`❌ Đăng xuất: ${req.session.user.username}`);
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: 'Lỗi khi đăng xuất.' });
      }
    });
  }
  res.json({ message: 'Đăng xuất thành công!' });
});

// ✅ THÊM MỚI: API Check Auth (/me)
app.get('/me', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Chưa đăng nhập.' });
  }

  try {
    // Refresh user từ DB để lấy info mới nhất (nếu cần)
    const user = await User.findById(req.session.user._id).select('username email role school class isVerified');
    if (!user) {
      return res.status(401).json({ message: 'Session hết hạn.' });
    }

    res.json(user);
  } catch (err) {
    console.error('Lỗi /me:', err);
    res.status(500).json({ message: 'Lỗi server.' });
  }
});

// =======================
// ✅ API CLASSROOM - THÊM MỚI
// =======================
const crypto = require('crypto');

// POST /api/classrooms - Tạo lớp mới (chỉ teacher)
app.post('/api/classrooms', async (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== 'teacher') {
    return res.status(403).json({ message: 'Chỉ giáo viên mới có quyền tạo lớp.' });
  }

  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ message: 'Tên lớp là bắt buộc.' });
  }

  try {
    // Tạo joinCode ngẫu nhiên 6 ký tự uppercase
    const joinCode = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6);

    const newClassroom = new Classroom({
      name,
      description,
      teacherUsername: user.username,
      joinCode,
      students: [],
      pendingStudents: []
    });

    await newClassroom.save();
    console.log(`✅ Tạo lớp thành công: ${name} (Mã: ${joinCode})`);

    res.json({ message: 'Tạo lớp thành công!', classroom: newClassroom });
  } catch (err) {
    console.error('Lỗi tạo lớp:', err);
    res.status(500).json({ message: 'Lỗi server khi tạo lớp.' });
  }
});

// GET /api/classrooms/my - Lấy lớp của user
app.get('/api/classrooms/my', async (req, res) => {
  const user = req.session.user;
  if (!user) {
    return res.status(401).json({ message: 'Bạn cần đăng nhập.' });
  }

  try {
    let filter = {};

    if (user.role === 'teacher') {
      // Teacher: Chỉ thấy lớp mình tạo
      filter.teacherUsername = user.username;
    } else if (user.role === 'student') {
      // Student: Thấy lớp đã join (students includes username) HOẶC pending (pendingStudents includes username)
      filter.$or = [
        { students: user.username },
        { pendingStudents: user.username }
      ];
    } else {
      // Admin: Thấy tất cả (nếu cần)
      filter = {};
    }

    const classrooms = await Classroom.find(filter)
      .sort({ createdAt: -1 })
      .lean();  // lean() để tối ưu performance

    // ✅ THÊM: Đảm bảo pendingStudents và students là array rỗng nếu undefined
    const safeClassrooms = classrooms.map(cls => ({
      ...cls,
      students: cls.students || [],
      pendingStudents: cls.pendingStudents || []
    }));

    res.json(safeClassrooms);
  } catch (err) {
    console.error('Lỗi lấy lớp của tôi:', err);
    res.status(500).json({ message: 'Lỗi server khi lấy lớp học.' });
  }
});

// POST /api/classrooms/join - Học sinh join lớp bằng mã
app.post('/api/classrooms/join', async (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== 'student') return res.status(403).json({ message: 'Chỉ học sinh mới join được.' });

  const { joinCode } = req.body;
  try {
    const classroom = await Classroom.findOne({ joinCode });
    if (!classroom) return res.status(404).json({ message: 'Mã lớp không tồn tại.' });

    if (classroom.students.includes(user.username) || classroom.pendingStudents.includes(user.username)) {
      return res.status(400).json({ message: 'Bạn đã tham gia hoặc đang chờ duyệt.' });
    }

    classroom.pendingStudents.push(user.username);  // ✅ Push string
    await classroom.save();
    res.json({ message: 'Yêu cầu tham gia đã gửi, chờ giáo viên duyệt.' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server.' });
  }
});
// POST /api/classrooms/:id/approve - Giáo viên duyệt/từ chối
app.post('/api/classrooms/:id/approve', async (req, res) => {
  const { studentUsername, action } = req.body;
  const classroom = await Classroom.findById(req.params.id);
  if (!classroom) return res.status(404).json({ message: 'Lớp không tồn tại.' });

  const pendingIndex = classroom.pendingStudents.indexOf(studentUsername);
  if (pendingIndex === -1) return res.status(400).json({ message: 'Không tìm thấy yêu cầu.' });

  if (action === 'approve') {
    classroom.pendingStudents.splice(pendingIndex, 1);
    classroom.students.push(studentUsername);  // ✅ Push string
  } else {
    classroom.pendingStudents.splice(pendingIndex, 1);
  }
  await classroom.save();
  res.json({ message: `Đã ${action === 'approve' ? 'duyệt' : 'từ chối'}.` });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    // Gọi Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: message }]
          }]
        })
      }
    );

    if (!response.ok) throw new Error('Gemini API error');
    const data = await response.json();
    const aiReply = data.candidates[0].content.parts[0].text;

    res.json({ reply: aiReply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Lỗi chat AI' });
  }
});

// =======================
// ✅ API EXAMS - TẠO VÀ LẤY ĐỀ THI
// =======================
// POST /api/exams - Tạo đề thi (teacher)
app.post('/api/exams', async (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== 'teacher') {
    return res.status(403).json({ message: 'Chỉ giáo viên mới tạo được đề thi.' });
  }

  const { title, subject, duration, questions, classrooms } = req.body; // classrooms: array ObjectId strings

  try {
    // ✅ Validate classrooms: Chuyển string ids thành ObjectId nếu có
    const classroomIds = classrooms ? classrooms.map(id => new mongoose.Types.ObjectId(id)) : [];

    // ✅ Kiểm tra teacher có quyền tạo cho các lớp này không (tùy chọn, để an toàn)
    if (classroomIds.length > 0) {
      const validClassrooms = await Classroom.find({
        _id: { $in: classroomIds },
        teacherUsername: user.username
      });
      if (validClassrooms.length !== classroomIds.length) {
        return res.status(403).json({ message: 'Bạn không có quyền tạo đề thi cho một số lớp.' });
      }
    }

    const exam = new Exam({
      title,
      subject,
      duration,
      questions,
      createdBy: user.username,
      classrooms: classroomIds
    });

    await exam.save();
    res.json({ success: true, exam });
  } catch (err) {
    console.error('Lỗi tạo đề thi:', err);
    res.status(500).json({ message: 'Lỗi server khi tạo đề thi.' });
  }
});

// ✅ GET /api/exams/by-class - List exams theo lớp (specific route TRƯỚC :id)
app.get('/api/exams/by-class', async (req, res) => {
  try {
    const user = req.session.user;
    if (!user) return res.status(401).json({ message: 'Bạn cần đăng nhập.' });

    let filter = {};

    if (user.role === 'student') {
      // ✅ FIX: Dùng username string trực tiếp (không cần Student model)
      const studentClassrooms = await Classroom.find({ students: user.username });
      if (studentClassrooms.length === 0) {
        return res.json([]);  // Không có lớp → Không có exam
      }

      const classroomIds = studentClassrooms.map(c => c._id);
      filter.classrooms = { $in: classroomIds };  // Exams gán cho lớp này
    } else if (user.role === 'teacher') {
      // Teacher: Chỉ thấy đề của mình (không filter lớp)
      filter.createdBy = user.username;
    }
    // Admin thấy tất cả

    // ✅ Populate classrooms để lấy tên lớp
    const exams = await Exam.find(filter)
      .populate('classrooms', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const safeExams = exams.map(exam => {
      const classNames = exam.classrooms ? exam.classrooms.map(cls => cls.name).join(', ') : 'Chưa phân bổ';
      return {
        _id: exam._id,
        title: exam.title,
        subject: exam.subject,
        duration: exam.duration,
        createdBy: exam.createdBy,
        className: classNames,
        createdAt: exam.createdAt
      };
    });

    res.json(safeExams);
  } catch (err) {
    console.error('Lỗi lấy đề thi theo lớp:', err);
    res.status(500).json({ message: 'Lỗi server khi lấy đề thi theo lớp.' });
  }
});

// ✅ GET /api/exams - List exams (fallback, filter theo lớp)
app.get("/api/exams", async (req, res) => {
  try {
    const user = req.session.user;
    if (!user) return res.status(401).json({ message: "Bạn cần đăng nhập." });

    let filter = {};

    if (user.role === "student") {
      // ✅ FIX: Dùng username string trực tiếp
      const studentClassrooms = await Classroom.find({ students: user.username });
      const classroomIds = studentClassrooms.map(c => c._id);
      filter.classrooms = { $in: classroomIds };
    } else if (user.role === "teacher") {
      filter.createdBy = user.username;
    }

    const exams = await Exam.find(filter)
      .populate('classrooms', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const safeExams = exams.map(exam => {
      const classNames = exam.classrooms ? exam.classrooms.map(cls => cls.name).join(', ') : 'Chưa phân bổ';
      return {
        _id: exam._id,
        title: exam.title,
        subject: exam.subject,
        duration: exam.duration,
        createdBy: exam.createdBy,
        className: classNames,
        createdAt: exam.createdAt
      };
    });

    res.json(safeExams);
  } catch (err) {
    console.error('Lỗi lấy đề thi:', err);
    res.status(500).json({ message: "Lỗi server", error: err.message });
  }
});

// ✅ GET /api/exams/:id - Chi tiết exam (dynamic route SAU /by-class)
app.get('/api/exams/:id', async (req, res) => {
  try {
    const examId = req.params.id;
    const user = req.session.user;
    if (!user) {
      return res.status(401).json({ message: 'Bạn cần đăng nhập để làm bài thi.' });
    }

    // ✅ Validate ID: Tránh CastError nếu ID không phải ObjectId
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ message: 'ID bài thi không hợp lệ.' });
    }

    // ✅ Tìm exam
    let exam = await Exam.findById(examId)
      .populate('classrooms', 'name')  // Populate tên lớp nếu cần
      .lean();

    if (!exam) {
      return res.status(404).json({ message: 'Không tìm thấy bài thi này.' });
    }

    // ✅ Filter quyền: Student chỉ làm nếu trong lớp của exam
    if (user.role === 'student') {
      // ✅ FIX: Dùng username string trực tiếp (không cần Student model)
      const studentClassrooms = await Classroom.find({ students: user.username });
      const studentClassIds = studentClassrooms.map(c => c._id.toString());

      // Kiểm tra exam có gán lớp của student không
      const examClassIds = exam.classrooms ? exam.classrooms.map(c => c._id.toString()) : [];
      if (examClassIds.length > 0 && !examClassIds.some(id => studentClassIds.includes(id))) {
        return res.status(403).json({ message: 'Bạn không có quyền làm bài thi này (không thuộc lớp được gán).' });
      }
    } else if (user.role !== 'teacher' && user.role !== 'admin') {
      return res.status(403).json({ message: 'Vai trò của bạn không được phép.' });
    }

    // Ẩn đáp án cho student (thêm safeExam như cũ)
    const safeExam = {
      _id: exam._id,
      title: exam.title,
      subject: exam.subject,
      duration: exam.duration,
      passage: exam.passage, 
      questions: exam.questions.map(q => ({
        _id: q._id,
        question: q.question,
        options: q.options,
        type: q.type
      }))
    };

    // ✅ Thêm className cho frontend
    const classNames = exam.classrooms ? exam.classrooms.map(cls => cls.name).join(', ') : 'Chưa phân bổ lớp';
    safeExam.className = classNames;

    res.json(safeExam);
  } catch (err) {
    if (err.name === 'CastError') {
      console.error('CastError cho exam ID:', req.params.id);
      return res.status(400).json({ message: 'ID bài thi không hợp lệ.' });
    }
    console.error('Lỗi lấy chi tiết bài thi:', err);
    res.status(500).json({ message: 'Lỗi server khi tải bài thi.' });
  }
});

// Nộp bài
app.post("/api/exams/:id/submit", async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ message: "Bạn cần đăng nhập để nộp bài." });

  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    // Kiểm tra phân quyền trước khi chấm
    if (user.role === "student") {
      // ✅ FIX: Dùng username string trực tiếp
      const studentClassrooms = await Classroom.find({ students: user.username });
      const studentClassroomIds = studentClassrooms.map(c => c._id.toString());
      const isAuthorized = exam.classrooms.some(examClassId => 
        studentClassroomIds.includes(examClassId.toString())
      );
      if (!isAuthorized) {
        return res.status(403).json({ message: "Bạn không thuộc lớp được giao bài thi này." });
      }
    }

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