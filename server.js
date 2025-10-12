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
const Classroom = require("./models/Classroom"); 
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

// Tạo thư mục uploads彬
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('uploads/chat')) fs.mkdirSync('uploads/chat');
if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads');

// Kết nối MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Kết nối MongoDB thành công!'))
  .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// Session setup
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
io.use(sharedsession(sessionMiddleware, { autoSave: true }));

// Middleware
app.use(cors({ origin: "*", credentials: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
const STUDENT_API_PREFIX = '/api/students';

// Hàm hỗ trợ tìm ID tuần tự tiếp theo (để đồng bộ với logic Front-end của bạn)
async function getNextStudentId() {
    // Tìm học sinh có ID lớn nhất hiện tại
    const lastStudent = await Student.findOne().sort({ id: -1 }).exec();
    return lastStudent ? lastStudent.id + 1 : 1;
}

// 1. API: GET /api/students - Tải tất cả học sinh
app.get(STUDENT_API_PREFIX, async (req, res) => {
    try {
        // Lấy tất cả học sinh từ MongoDB
        const students = await Student.find().exec();
        res.json(students);
    } catch (error) {
        console.error("Lỗi khi tải học sinh:", error);
        res.status(500).json({ message: "Lỗi Server khi tải dữ liệu học sinh." });
    }
});

// 2. API: POST /api/students - Thêm học sinh mới (danh sách)
app.post(STUDENT_API_PREFIX, async (req, res) => {
    try {
        let newStudents = req.body;
        if (!Array.isArray(newStudents)) {
            newStudents = [newStudents];
        }

        const addedStudents = [];
        let nextId = await getNextStudentId();
        
        for (const studentData of newStudents) {
            // Đảm bảo username là duy nhất
            const existingStudent = await Student.findOne({ username: studentData.username });
            if (existingStudent) continue; 
            
            const student = new Student({
                id: nextId++,
                username: studentData.username,
                fullname: studentData.fullname,
                class: studentData.class,
                dob: studentData.dob,
                scores: studentData.scores || {} 
            });
            
            const savedStudent = await student.save();
            addedStudents.push(savedStudent);
        }

        if (addedStudents.length === 0) {
            return res.status(400).json({ message: "Không có học sinh hợp lệ nào được thêm hoặc tất cả đều đã tồn tại." });
        }

        res.status(201).json(addedStudents);
    } catch (error) {
        console.error("Lỗi khi thêm học sinh:", error);
        res.status(500).json({ message: "Lỗi Server khi thêm học sinh.", error: error.message });
    }
});

// 3. API: PUT /api/students/:id/scores - Cập nhật điểm của một học sinh
app.put(`${STUDENT_API_PREFIX}/:id/scores`, async (req, res) => {
    try {
        const studentId = parseInt(req.params.id);
        const { scores } = req.body;
        
        const updatedStudent = await Student.findOneAndUpdate(
            { id: studentId }, // Tìm kiếm bằng field 'id' (Number)
            { $set: { scores: scores } },
            { new: true, runValidators: true }
        );
        
        if (!updatedStudent) {
            return res.status(404).json({ message: "Không tìm thấy học sinh để cập nhật điểm." });
        }

        res.json(updatedStudent);
    } catch (error) {
        console.error("Lỗi khi cập nhật điểm:", error);
        res.status(500).json({ message: "Lỗi Server khi cập nhật điểm.", error: error.message });
    }
});

// 4. API: DELETE /api/students/:id - Xóa học sinh
app.delete(`${STUDENT_API_PREFIX}/:id`, async (req, res) => {
    try {
        const studentId = parseInt(req.params.id);
        const result = await Student.deleteOne({ id: studentId });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Không tìm thấy học sinh để xóa." });
        }

        res.status(200).json({ message: "Đã xóa học sinh thành công." });
    } catch (error) {
        console.error("Lỗi khi xóa học sinh:", error);
        res.status(500).json({ message: "Lỗi Server khi xóa học sinh." });
    }
});
// --- KẾT THÚC KHỐI CODE API STUDENT ---

app.get('/videocall', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/videocall.html'));
});
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Cloudinary cấu hình
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET
});

// Upload bài tập (Cloudinary)
const baiTapStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "bai_tap_hoc_sinh",
    allowed_formats: ["jpg", "png", "jpeg"]
  }
});
const baiTapUpload = multer({ storage: baiTapStorage });

// Upload chat (Cloudinary)
const chatStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "chat_uploads",
    resource_type: "auto"
  }
});
const chatUpload = multer({ storage: chatStorage });

// Upload forum (Local)
const forumUpload = multer({
  storage: multer.diskStorage({
    destination: "public/uploads/",
    filename: (req, file, cb) => {
      cb(null, Date.now() + path.extname(file.originalname));
    },
  }),
});

// Upload comment (Cloudinary)
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

// Load posts từ file
function loadPosts() {
  return JSON.parse(fs.readFileSync('posts.json', 'utf-8'));
}
function savePosts(posts) {
  fs.writeFileSync('posts.json', JSON.stringify(posts, null, 2));
}

// Tạo bài đăng
app.post("/api/posts", forumUpload.single("image"), async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: "Bạn phải đăng nhập để đăng bài" });
  }

  if (!req.file) {
    return res.status(400).json({ message: "Chưa có ảnh" });
  }

  const post = new Post({
    author: req.session.user.username,
    caption: req.body.caption,
    imageUrl: "/uploads/" + req.file.filename,
  });

  await post.save();
  res.json(post);
});

// Lấy danh sách bài đăng
app.get("/api/posts", async (req, res) => {
  const posts = await Post.find().sort({ createdAt: -1 });
  res.json(posts);
});

// Thêm bình luận
app.post("/api/posts/:id/comments", commentUpload.single("image"), async (req, res) => {
  const comment = new Comment({
    postId: req.params.id,
    author: req.session?.user?.username || "Ẩn danh",
    content: req.body.content,
    imageUrl: req.file ? req.file.path : null
  });
  await comment.save();
  res.json(comment);
});

// Lấy bình luận
app.get("/api/posts/:id/comments", async (req, res) => {
  const comments = await Comment.find({ postId: req.params.id }).sort({ createdAt: 1 });
  res.json(comments);
});

// API: Đăng ký tài khoản
const nodemailer = require('nodemailer');

app.post('/api/send-otp', async (req, res) => {
  const { email } = req.body;

  try {
    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: "Email không hợp lệ." });
    }

    const existingUser = await User.findOne({ email, isVerified: true });
    if (existingUser) {
      return res.json({ message: 'Email đã được đăng ký tài khoản.' });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    fs.writeFileSync(
      'temp-otp.json',
      JSON.stringify({ email, otpCode, time: Date.now() })
    );

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

// Xác minh OTP và tạo tài khoản
app.post('/api/register', async (req, res) => {
  const { username, email, password, role, school, class: cls, otp } = req.body;

  try {
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

    fs.unlinkSync('temp-otp.json');

    const existing = await User.findOne({ email });
    if (existing && existing.isVerified) {
      return res.status(400).json({ message: "Tài khoản đã tồn tại." });
    }

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

    if (role === 'student') {
      try {
        const newStudent = new Student({
          id: username,
          username: username,
          school: school,
          class: cls
        });
        await newStudent.save();
        console.log('✅ Đã tạo Student document cho:', username);
      } catch (studentErr) {
        console.error('Lỗi tạo Student (không ảnh hưởng User):', studentErr);
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

// API Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ message: 'Vui lòng nhập đầy đủ tài khoản và mật khẩu.' });
  }

  try {
    const user = await User.findOne({ username, password });
    if (!user || !user.isVerified) {
      return res.status(401).json({ message: 'Tài khoản hoặc mật khẩu không đúng.' });
    }

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

// API Logout
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

// API Check Auth
app.get('/me', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Chưa đăng nhập.' });
  }

  try {
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

// API CLASSROOM
const crypto = require('crypto');

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

app.get('/api/classrooms/my', async (req, res) => {
  const user = req.session.user;
  if (!user) {
    return res.status(401).json({ message: 'Bạn cần đăng nhập.' });
  }

  try {
    let filter = {};

    if (user.role === 'teacher') {
      filter.teacherUsername = user.username;
    } else if (user.role === 'student') {
      filter.$or = [
        { students: user.username },
        { pendingStudents: user.username }
      ];
    }

    const classrooms = await Classroom.find(filter)
      .sort({ createdAt: -1 })
      .lean();

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

    classroom.pendingStudents.push(user.username);
    await classroom.save();
    res.json({ message: 'Yêu cầu tham gia đã gửi, chờ giáo viên duyệt.' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server.' });
  }
});

app.post('/api/classrooms/:id/approve', async (req, res) => {
  const { studentUsername, action } = req.body;
  const classroom = await Classroom.findById(req.params.id);
  if (!classroom) return res.status(404).json({ message: 'Lớp không tồn tại.' });

  const pendingIndex = classroom.pendingStudents.indexOf(studentUsername);
  if (pendingIndex === -1) return res.status(400).json({ message: 'Không tìm thấy yêu cầu.' });

  if (action === 'approve') {
    classroom.pendingStudents.splice(pendingIndex, 1);
    classroom.students.push(studentUsername);
  } else {
    classroom.pendingStudents.splice(pendingIndex, 1);
  }
  await classroom.save();
  res.json({ message: `Đã ${action === 'approve' ? 'duyệt' : 'từ chối'}.` });
});

// API EXAMS
app.post('/api/exams', async (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== 'teacher') {
    return res.status(403).json({ message: 'Chỉ giáo viên mới tạo được đề thi.' });
  }

  const { title, subject, duration, passage, questions, classrooms } = req.body;

  // Kiểm tra các trường bắt buộc
  if (!title || !subject || !duration || !questions || !classrooms || classrooms.length === 0) {
    return res.status(400).json({ message: 'Thiếu thông tin bắt buộc.' });
  }

  try {
    // Validate classroom IDs
    const classroomIds = classrooms.map(id => {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error(`ID lớp không hợp lệ: ${id}`);
      }
      return new mongoose.Types.ObjectId(id);
    });

    // Kiểm tra quyền tạo đề cho các lớp
    if (classroomIds.length > 0) {
      const validClassrooms = await Classroom.find({
        _id: { $in: classroomIds },
        teacherUsername: user.username
      });
      if (validClassrooms.length !== classroomIds.length) {
        return res.status(403).json({ message: 'Bạn không có quyền tạo đề thi cho một số lớp.' });
      }
    }

    // Kiểm tra định dạng câu hỏi
    for (const q of questions) {
      if (!q.question || !q.type) {
        return res.status(400).json({ message: 'Câu hỏi không hợp lệ: Thiếu nội dung hoặc loại.' });
      }
      if (!['tracnghiem', 'truefalse', 'shortanswer'].includes(q.type)) {
        return res.status(400).json({ message: `Loại câu hỏi không hợp lệ: ${q.type}` });
      }
      if (q.type === 'tracnghiem') {
        if (!q.options || q.options.length < 2 || q.correctAnswer === undefined || q.correctAnswer === null || !Number.isInteger(Number(q.correctAnswer)) || Number(q.correctAnswer) < 0 || Number(q.correctAnswer) >= q.options.length) {
          return res.status(400).json({ message: 'Câu trắc nghiệm phải có ít nhất 2 lựa chọn và đáp án đúng hợp lệ.' });
        }
      } else if (q.type === 'truefalse') {
        if (!q.options || q.options.length !== 2 || q.correctAnswer === undefined || q.correctAnswer === null || !Number.isInteger(Number(q.correctAnswer)) || Number(q.correctAnswer) < 0 || Number(q.correctAnswer) > 1) {
          return res.status(400).json({ message: 'Câu Đúng/Sai phải có đúng 2 lựa chọn và đáp án đúng hợp lệ.' });
        }
        if (q.options[0] !== 'Đúng' || q.options[1] !== 'Sai') {
          return res.status(400).json({ message: 'Câu Đúng/Sai phải có lựa chọn "Đúng" và "Sai".' });
        }
      } else if (q.type === 'shortanswer') {
        if (q.options && q.options.length > 0) {
          return res.status(400).json({ message: 'Câu trả lời ngắn không được có lựa chọn.' });
        }
        if (q.correctAnswer !== null && typeof q.correctAnswer !== 'string') {
          return res.status(400).json({ message: 'Đáp án đúng của câu trả lời ngắn phải là chuỗi hoặc null.' });
        }
      }
    }

    const exam = new Exam({
      title,
      subject,
      duration,
      passage: passage || '',
      questions,
      createdBy: user.username,
      classrooms: classroomIds
    });

    await exam.save();
    res.json({ success: true, exam });
  } catch (err) {
    console.error('Lỗi tạo đề thi:', err);
    res.status(500).json({ message: `Lỗi server khi tạo đề thi: ${err.message}` });
  }
});

app.get('/api/exams/by-class', async (req, res) => {
  try {
    const user = req.session.user;
    if (!user) return res.status(401).json({ message: 'Bạn cần đăng nhập.' });

    let filter = {};

    if (user.role === 'student') {
      const studentClassrooms = await Classroom.find({ students: user.username });
      if (studentClassrooms.length === 0) {
        return res.json([]);
      }

      const classroomIds = studentClassrooms.map(c => c._id);
      filter.classrooms = { $in: classroomIds };
    } else if (user.role === 'teacher') {
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
    console.error('Lỗi lấy đề thi theo lớp:', err);
    res.status(500).json({ message: 'Lỗi server khi lấy đề thi theo lớp.' });
  }
});

app.get("/api/exams", async (req, res) => {
  try {
    const user = req.session.user;
    if (!user) return res.status(401).json({ message: "Bạn cần đăng nhập." });

    let filter = {};

    if (user.role === "student") {
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

app.get('/api/exams/:id', async (req, res) => {
  try {
    const examId = req.params.id;
    const user = req.session.user;
    if (!user) {
      return res.status(401).json({ message: 'Bạn cần đăng nhập để làm bài thi.' });
    }

    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ message: 'ID bài thi không hợp lệ.' });
    }

    let exam = await Exam.findById(examId)
      .populate('classrooms', 'name')
      .lean();

    if (!exam) {
      return res.status(404).json({ message: 'Không tìm thấy bài thi này.' });
    }

    if (user.role === 'student') {
      const studentClassrooms = await Classroom.find({ students: user.username });
      const studentClassIds = studentClassrooms.map(c => c._id.toString());
      const examClassIds = exam.classrooms ? exam.classrooms.map(c => c._id.toString()) : [];
      if (examClassIds.length > 0 && !examClassIds.some(id => studentClassIds.includes(id))) {
        return res.status(403).json({ message: 'Bạn không có quyền làm bài thi này (không thuộc lớp được gán).' });
      }
    } else if (user.role !== 'teacher' && user.role !== 'admin') {
      return res.status(403).json({ message: 'Vai trò của bạn không được phép.' });
    }

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

    const classNames = exam.classrooms ? exam.classrooms.map(cls => cls.name).join(', ') : 'Chưa phân bổ';
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

app.post("/api/exams/:id/submit", async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ message: "Bạn cần đăng nhập để nộp bài." });

  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ message: "Không tìm thấy bài thi." });

    if (user.role === "student") {
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
    if (!answers || answers.length !== exam.questions.length) {
      return res.status(400).json({ message: "Danh sách câu trả lời không hợp lệ." });
    }

    let correctCount = 0;
    let hasShortAnswer = false;
    const detailedAnswers = [];

    exam.questions.forEach((q, i) => {
      const studentAns = answers[i];

      if (q.type === 'tracnghiem' || q.type === 'truefalse') {
        if (studentAns !== null && studentAns !== undefined && !Number.isInteger(Number(studentAns))) {
          throw new Error(`Câu trả lời cho câu ${i+1} phải là số nguyên hoặc null.`);
        }
        if (studentAns !== null && parseInt(studentAns) === parseInt(q.correctAnswer)) {
          correctCount++;
        }
      } else if (q.type === 'shortanswer') {
        hasShortAnswer = true;
        if (studentAns !== null && typeof studentAns !== 'string') {
          throw new Error(`Câu trả lời cho câu ${i+1} phải là chuỗi hoặc null.`);
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

    const autoGradedQuestions = exam.questions.filter(q => q.type !== 'shortanswer').length;
    const score = autoGradedQuestions > 0 ? (correctCount / autoGradedQuestions) * 10 : null;

    const result = new Result({
      examId: exam._id,
      userId: req.session.user?.username || "anonymous",
      answers: detailedAnswers,
      score: hasShortAnswer ? null : Math.round(score * 10) / 10,
      status: hasShortAnswer ? "pending" : "graded"
    });

    await result.save();

    res.json({ 
      message: "Nộp bài thành công", 
      score: result.score, 
      status: result.status, 
      result 
    });
  } catch (err) {
    console.error('Lỗi nộp bài:', err);
    res.status(500).json({ message: `Lỗi khi nộp bài: ${err.message}` });
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

app.get("/api/exams/:id/exit-log", async (req, res) => {
  try {
    const logs = await ExitLog.find({ examId: req.params.id }).sort({ timestamp: -1 });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/exams/:id/results", async (req, res) => {
  try {
    const examId = req.params.id;
    const results = await Result.find({ examId }).lean();
    const exam = await Exam.findById(examId).lean();

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
            answer: ans.answer,
            correctAnswer: q.correctAnswer
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

app.post("/api/results/:id/grade", async (req, res) => {
  const { score } = req.body;
  if (!req.session.user || req.session.user.role !== "teacher") {
    return res.status(403).json({ message: "Không có quyền" });
  }
  const result = await Result.findByIdAndUpdate(req.params.id, { score, status: "graded" }, { new: true });
  res.json({ success: true, result });
});

app.post('/chat-upload', chatUpload.single('file'), (req, res) => {
  if (!req.file || !req.file.path) {
    return res.status(400).json({ error: "Upload thất bại" });
  }
  res.json({ url: req.file.path });
});

// SOCKET.IO CHAT
let onlineUsers = 0;

io.on("connection", (socket) => {
  const sessionUser = socket.handshake.session?.user;
  socket.username = sessionUser?.username || "Ẩn danh";

  onlineUsers++;
  console.log("✅ Người dùng kết nối:", socket.id, "->", socket.username);
  io.emit("serverMessage", `${socket.username} đã tham gia phòng chat`);
  io.emit("onlineCount", onlineUsers);

  socket.on("chatMessage", (payload) => {
    if (typeof payload === "string") {
      payload = { user: socket.username, message: payload };
    } else {
      payload.user = payload.user || socket.username;
    }

    io.emit("chatMessage", payload);
  });

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
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: message }] }]
        })
      }
    );

    const data = await response.json();
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
// Khởi động server
server.listen(PORT, () => {
  console.log(`✅ Server đang chạy tại http://localhost:${PORT}`);
});
