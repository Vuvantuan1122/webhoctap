require('dotenv').config();
const ExamVideo = require("./models/ExamVideo");
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
const Report = require('./models/Report');
const Exam = require("./models/Exam");
const Result = require("./models/Result");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const ExitLog = require("./models/ExitLog");
const Classroom = require("./models/Classroom"); 
const http = require('http');
const { Server } = require('socket.io');
const { sendVerificationEmail } = require('./utils/mailer');
const { isMultiTF, gradeAuto, validateTfData, toBit } = require('./utils/scoring');
const User = require('./models/user');
const Student = require('./models/student');

// =================================================================
// THÊM: Định nghĩa Submission Model (Bài nộp)
// =================================================================
const submissionSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true },
    fileUrl: { type: String, required: true },
    fileName: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
});
const Submission = mongoose.model("Submission", submissionSchema);


const app = express();
app.use(express.json());
// ĐÃ GỠ routes/results.js: có POST /api/submit không cần đăng nhập (ai cũng ghi đè được điểm thi)
// và GET /api/exams/:id/results che mất route có kiểm tra quyền ở bên dưới. Không trang nào gọi /api/submit.


const server = http.createServer(app);
app.set('trust proxy', true);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Tạo thư mục uploads
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
    const user = req.session.user;
    if (!user) return res.status(401).json({ message: "Bạn cần đăng nhập." });
    try {
        // Giáo viên/admin xem tất cả; học sinh chỉ xem hồ sơ của chính mình
        const students = await Student.find(isStaff(user) ? {} : { username: user.username }).exec();
        res.json(students);
    } catch (error) {
        console.error("Lỗi khi tải học sinh:", error);
        res.status(500).json({ message: "Lỗi Server khi tải dữ liệu học sinh." });
    }
});

// 2. API: POST /api/students - Thêm học sinh mới (danh sách)
app.post(STUDENT_API_PREFIX, async (req, res) => {
    if (!isStaff(req.session.user)) return res.status(403).json({ message: "Chỉ giáo viên mới được thêm học sinh." });
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
    if (!isStaff(req.session.user)) return res.status(403).json({ message: "Chỉ giáo viên mới được sửa điểm." });
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
    if (!isStaff(req.session.user)) return res.status(403).json({ message: "Chỉ giáo viên mới được xóa học sinh." });
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
    allowed_formats: ["jpg", "png", "jpeg", "pdf"] // ĐÃ THÊM PDF
  }
});
const baiTapUpload = multer({ storage: baiTapStorage });


// =================================================================
// SỬA & THAY THẾ: API Nộp Bài Tập (Fix lỗi tải ảnh và thêm classId)
// =================================================================
app.post('/api/upload', baiTapUpload.array('images', 10), async (req, res) => { // SỬA: Dùng .array('images')
  try {
    if (!req.session.user) {
      return res.status(401).json({ message: "Bạn cần đăng nhập để nộp bài." });
    }

    const user = req.session.user;
    const { classId } = req.body; // THÊM: Lấy classId từ form data

    if (!classId || !mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ message: "Vui lòng chọn lớp học hợp lệ." });
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "Chưa có file được tải lên." });
    }

    // Lưu thông tin bài nộp vào MongoDB
    const submissions = req.files.map(file => ({
  userId: user.username,
  classId: new mongoose.Types.ObjectId(classId), // ✅ Lưu đúng dạng ObjectId
  fileUrl: file.path,
  fileName: file.originalname,
}));
    
    await Submission.insertMany(submissions); // Lưu nhiều bản ghi cùng lúc

    res.json({ message: "✅ Nộp bài thành công!", count: submissions.length });
  } catch (err) {
    console.error("❌ Lỗi khi nộp bài:", err);
    res.status(500).json({ message: "Lỗi máy chủ khi nộp bài.", error: err.message });
  }
});
// =================================================================
// 🎥 API: Upload video thi (ghi lại quá trình làm bài)
// =================================================================

const examVideoStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "exam_videos",
    resource_type: "video"
  }
});

const videoUpload = multer({ storage: examVideoStorage });

app.post("/api/upload-exam-video",
  (req, res, next) => (req.session.user ? next() : res.status(401).json({ message: "Bạn cần đăng nhập." })),
  videoUpload.single("video"),
  async (req, res) => {
    console.log("🎥 Server vừa nhận video:", req.file?.path);
    try {
      const { examId, classId } = req.body;
      const userId = req.session.user.username; // lấy từ phiên đăng nhập, không tin dữ liệu client gửi
      if (!mongoose.Types.ObjectId.isValid(examId)) {
        return res.status(400).json({ message: "ID bài thi không hợp lệ." });
      }
      if (!req.file) {
        console.warn("⚠️ Không có file trong request");
        return res.status(400).json({ message: "Không có video" });
      }

      const newVideo = new ExamVideo({
        userId,
        examId: new mongoose.Types.ObjectId(examId),
        classId: classId ? new mongoose.Types.ObjectId(classId) : null,
        videoUrl: req.file.path.trim() // Loại bỏ khoảng trắng thừa
      });
      await newVideo.save();
      console.log("✅ Đã lưu ExamVideo:", newVideo);

      res.json({ message: "✅ Upload thành công!", url: req.file.path });
    } catch (e) {
      console.error("❌ Lỗi upload video:", e);
      res.status(500).json({ message: "Lỗi server" });
    }
  });

// =================================================================
// SỬA LỖI: API tải danh sách video (Sử dụng ObjectId cho examId)
// =================================================================
app.get("/api/exam-videos", async (req, res) => {
  try {
    const user = req.session.user;
    if (!user || user.role !== "teacher") {
      return res.status(403).json({ message: "Chỉ giáo viên được phép xem video thi." });
    }

    const { examId } = req.query;
    let filter = {};
    
    // SỬA LỖI QUAN TRỌNG: Chuyển examId sang ObjectId nếu tồn tại
    if (examId && examId !== 'all') { // Bỏ qua khi chọn 'Tất cả bài thi'
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            return res.status(400).json({ message: "ID bài thi không hợp lệ." });
        }
        filter.examId = new mongoose.Types.ObjectId(examId); // ✅ ĐÃ SỬA LỖI
    }
    
    // Giáo viên chỉ xem video của đề do mình tạo (trước đây xem được video thi của mọi lớp)
    {
      const ownedIds = (await Exam.find({ createdBy: user.username }).select('_id').lean()).map((e) => e._id);
      if (filter.examId) {
        if (!ownedIds.some((id) => id.equals(filter.examId))) {
          return res.status(403).json({ message: "Đây không phải đề thi của bạn." });
        }
      } else {
        filter.examId = { $in: ownedIds };
      }
    }

    const videos = await ExamVideo.find(filter)
      .populate("examId", "title")
      .populate("classId", "name")
      .sort({ uploadedAt: -1 })
      .lean();
      
    res.json(videos);
  } catch (err) {
    console.error("❌ Lỗi khi tải danh sách video giám sát:", err);
    res.status(500).json({ message: "Lỗi máy chủ khi tải danh sách video giám sát." });
  }
});


// Đảm bảo bạn đã import mongoose ở đầu file, ví dụ: const mongoose = require('mongoose');

// =================================================================
// SỬA LỖI: API tải danh sách video (Sử dụng ObjectId cho examId)
// =================================================================
app.get("/api/exam-videos", async (req, res) => {
  try {
    const user = req.session.user;
    if (!user || user.role !== "teacher") {
      return res.status(403).json({ message: "Chỉ giáo viên được phép xem video thi." });
    }

    const { examId } = req.query;
    let filter = {};
    
    // SỬA LỖI QUAN TRỌNG: Chuyển examId sang ObjectId nếu tồn tại
    if (examId) {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            // Trường hợp: người dùng chọn "Tất cả bài thi" (examId = 'all')
            if (examId !== 'all') { 
                return res.status(400).json({ message: "ID bài thi không hợp lệ." });
            }
        } else {
            // Trường hợp: ID hợp lệ, thêm vào filter
            filter.examId = new mongoose.Types.ObjectId(examId);
        }
    }
    
    // Nếu có thêm filter classId, có thể thêm ở đây:
    // const { classId } = req.query;
    // if (classId && classId !== 'all') {
    //     if (mongoose.Types.ObjectId.isValid(classId)) {
    //         filter.classId = new mongoose.Types.ObjectId(classId);
    //     }
    // }

    const videos = await ExamVideo.find(filter)
      .populate("examId", "title")
      .populate("classId", "name")
      .sort({ uploadedAt: -1 })
      .lean();
      
    res.json(videos);
  } catch (err) {
    console.error("❌ Lỗi khi tải danh sách video giám sát:", err);
    res.status(500).json({ message: "Lỗi máy chủ khi tải danh sách video giám sát." });
  }
});
app.get('/api/images', async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ message: "Bạn cần đăng nhập." });
    }

    const user = req.session.user;
    const { classId } = req.query;
    let filter = {};

    // 🧩 Nếu giáo viên lọc theo lớp
    if (user.role === "teacher") {
      if (classId && classId !== "all") {
        if (!mongoose.Types.ObjectId.isValid(classId)) {
          return res.status(400).json({ message: "ID lớp không hợp lệ." });
        }

        // Kiểm tra quyền xem lớp
        const classroom = await Classroom.findById(classId);
        if (!classroom || classroom.teacherUsername !== user.username) {
          return res.status(403).json({ message: "Bạn không có quyền xem lớp này." });
        }

        filter.classId = new mongoose.Types.ObjectId(classId);
      } else if (classId === "all") {
        const myClassrooms = await Classroom.find({ teacherUsername: user.username });
        filter.classId = { $in: myClassrooms.map(c => c._id) };
      }
    }

    // 🧩 Nếu học sinh xem bài
    if (user.role === "student") {
      const myClasses = await Classroom.find({ students: user.username });
      const myClassIds = myClasses.map(c => c._id);

      if (classId && classId !== "all") {
        if (!mongoose.Types.ObjectId.isValid(classId)) {
          return res.status(400).json({ message: "ID lớp không hợp lệ." });
        }
        filter.classId = new mongoose.Types.ObjectId(classId);
      } else {
        filter.classId = { $in: myClassIds };
      }
    }

    // 📦 Lấy danh sách bài tập
    const submissions = await Submission.find(filter)
      .sort({ timestamp: -1 })
      .lean();

    // 🖼️ Chuẩn hóa dữ liệu trả về
    const images = submissions.map(sub => ({
      url: sub.fileUrl,
      classId: sub.classId?.toString(),
      userId: sub.userId,
      timestamp: sub.timestamp
    }));

    res.json(images);
  } catch (err) {
    console.error("❌ Lỗi khi tải ảnh bài tập:", err);
    res.status(500).json({ message: "Lỗi server khi tải ảnh bài tập." });
  }
});
// XÓA ĐOẠN CODE CŨ VÀ KHÔNG SỬ DỤNG:
// app.post('/api/upload-baitap', baiTapUpload.single('file'), async (req, res) => { /* ... */ });


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

// ===================== ĐĂNG KÝ TÀI KHOẢN (không cần mã OTP) =====================
app.post('/api/register', async (req, res) => {
  const { username, email, password, role, school, class: cls } = req.body;

  try {
    if (!username || !email || !password || !role) {
      return res.status(400).json({ message: "Vui lòng nhập đầy đủ thông tin." });
    }
    if (!String(email).includes('@')) {
      return res.status(400).json({ message: "Email không hợp lệ." });
    }
    // Không cho tự đăng ký quyền admin (admin tạo bằng create-user.js)
    if (!['student', 'teacher'].includes(role)) {
      return res.status(400).json({ message: "Vai trò không hợp lệ." });
    }

    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) {
      return res.status(400).json({ message: "Tên đăng nhập hoặc email đã được sử dụng." });
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
  const user = req.session.user;
  if (!user || user.role !== 'teacher') {
    return res.status(403).json({ message: 'Chỉ giáo viên mới được duyệt học sinh.' });
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: 'ID lớp không hợp lệ.' });
  }
  const { studentUsername, action } = req.body;
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ message: 'Hành động không hợp lệ.' });
  }

  try {
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ message: 'Lớp không tồn tại.' });
    if (classroom.teacherUsername !== user.username) {
      return res.status(403).json({ message: 'Đây không phải lớp của bạn.' });
    }

    const pendingIndex = classroom.pendingStudents.indexOf(studentUsername);
    if (pendingIndex === -1) return res.status(400).json({ message: 'Không tìm thấy yêu cầu.' });

    classroom.pendingStudents.splice(pendingIndex, 1);
    if (action === 'approve' && !classroom.students.includes(studentUsername)) {
      classroom.students.push(studentUsername);
    }
    await classroom.save();
    res.json({ message: `Đã ${action === 'approve' ? 'duyệt' : 'từ chối'}.` });
  } catch (err) {
    console.error('Lỗi duyệt học sinh:', err);
    res.status(500).json({ message: 'Lỗi server khi duyệt học sinh.' });
  }
});

// API EXAMS
app.post('/api/exams', async (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== 'teacher') {
    return res.status(403).json({ message: 'Chỉ giáo viên mới tạo được đề thi.' });
  }

  const { title, subject, duration, passage, questions, classrooms, enableCamera } = req.body;

  // Kiểm tra các trường bắt buộc
  if (!title || !subject || !(Number(duration) > 0) || !Array.isArray(questions) || questions.length === 0 || !Array.isArray(classrooms) || classrooms.length === 0) {
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
        // Câu Đúng/Sai theo quy định của Bộ GD&ĐT: 4 ý a, b, c, d; mỗi ý có đáp án Đúng hoặc Sai
        const tfErr = validateTfData(q.options, q.correctAnswer);
        if (tfErr) return res.status(400).json({ message: tfErr });
        q.options = q.options.map((o) => String(o).trim());
        q.correctAnswer = q.correctAnswer.map((v) => toBit(v));
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
      classrooms: classroomIds,
      enableCamera: enableCamera === true // trước đây giá trị này bị bỏ qua nên camera giám sát không bao giờ bật
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
  enableCamera: !!exam.enableCamera,
  questions: exam.questions.map(q => ({
    _id: q._id,
    question: q.question,
    options: q.options,
    type: q.type
    // correctAnswer: q.correctAnswer  ← không gửi
  }))
};
res.json(safeExam);

    

    const classNames = exam.classrooms ? exam.classrooms.map(cls => cls.name).join(', ') : 'Chưa phân bổ';
    safeExam.className = classNames;

    
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

    // Kiểm tra quyền làm bài... (giữ nguyên)
    if (user.role === "student") {
      const studentClassrooms = await Classroom.find({ students: user.username });
      const studentIds = studentClassrooms.map(c => c._id.toString());
      const examIds = (exam.classrooms || []).map(c => c.toString());
      if (examIds.length > 0 && !examIds.some(id => studentIds.includes(id)))
        return res.status(403).json({ message: "Bạn không thuộc lớp được giao bài thi này." });
    }

    // Kiểm tra cấu trúc answers... (giữ nguyên)
    let { answers } = req.body;
    if (!Array.isArray(answers) || answers.length !== exam.questions.length)
      return res.status(400).json({ message: "Danh sách câu trả lời không hợp lệ." });

    // Chấm điểm
    let correctCount = 0, totalPoints = 0, hasShortAnswer = false; // correctCount = số câu đúng hoàn toàn; totalPoints = tổng điểm (mỗi câu tối đa 1)
    const detailedAnswers = exam.questions.map((q, i) => {
// ... (Giữ nguyên logic tính detailedAnswers)
      const studentAns = answers[i];
      const isShort = q.type === "shortanswer";

      if (isShort) {
        hasShortAnswer = true;
        return {
          question: q.question,
          type: q.type,
          options: q.options,
          correctAnswer: q.correctAnswer,
          answer: (studentAns === null || studentAns === undefined) ? "" : String(studentAns)
        };
      }

      // Đúng/Sai 4 ý: chấm theo thang của Bộ GD&ĐT (1 ý 0,1đ; 2 ý 0,25đ; 3 ý 0,5đ; 4 ý 1đ)
      if (isMultiTF(q)) {
        const given = Array.isArray(studentAns) ? studentAns : [];
        const normalized = [0, 1, 2, 3].map((k) => toBit(given[k]));
        const g = gradeAuto(q, normalized);
        totalPoints += g.points;
        if (g.full) correctCount++;
        return {
          question: q.question,
          type: q.type,
          options: q.options,
          correctAnswer: q.correctAnswer,
          answer: normalized,
          points: g.points,
          correctStatements: g.correctCount
        };
      }

      // Trắc nghiệm (và Đúng/Sai kiểu cũ): đúng = 1 điểm
      const ansIndex = (studentAns !== null && studentAns !== undefined) ? Number(studentAns) : NaN;
      const g = gradeAuto(q, Number.isNaN(ansIndex) ? null : ansIndex);
      totalPoints += g.points;
      if (g.full) correctCount++;
      return {
        question: q.question,
        type: q.type,
        options: q.options,
        correctAnswer: q.correctAnswer,
        answer: Number.isNaN(ansIndex) ? null : ansIndex,
        points: g.points
      };
    });
// ... (Phần tính score)
    // Mỗi câu tối đa 1 điểm => điểm thang 10 = tổng điểm các câu / số câu tự chấm * 10
    const autoGradedQuestions = exam.questions.filter(q => q.type !== "shortanswer").length;
    const score = autoGradedQuestions > 0
      ? Math.round((totalPoints / autoGradedQuestions) * 10 * 100) / 100
      : null;

    const result = new Result({
      examId: exam._id,
      userId: user.username,
      answers: detailedAnswers,
      score: hasShortAnswer ? null : score,
      status: hasShortAnswer ? "pending" : "graded"
    });

    await result.save();

    // SỬA: Thay score (điểm trên thang 10) bằng correctCount (số câu đúng) cho frontend
    res.json({
      message: "Nộp bài thành công",
      correctCount: correctCount, // số câu đúng hoàn toàn
      totalPoints: Math.round(totalPoints * 100) / 100, // tổng điểm các câu tự chấm (mỗi câu tối đa 1 điểm)
      autoGradedCount: autoGradedQuestions,
      score,
      status: result.status,
      submittedAt: result.createdAt,
    });
  } catch (err) {
    console.error("❌ Lỗi nộp bài:", err);
    res.status(500).json({ message: `Lỗi khi nộp bài: ${err.message}` });
  }
});

// ---------- Phân quyền cho giáo viên ----------
function isStaff(u) { return !!u && (u.role === 'teacher' || u.role === 'admin'); }

// Trả về đề thi nếu người dùng là giáo viên sở hữu (hoặc admin). Nếu không, tự gửi lỗi và trả null.
async function getOwnedExam(req, res, examId) {
  const user = req.session.user;
  if (!user) { res.status(401).json({ message: 'Bạn cần đăng nhập.' }); return null; }
  if (!isStaff(user)) { res.status(403).json({ message: 'Chỉ giáo viên mới có quyền này.' }); return null; }
  if (!mongoose.Types.ObjectId.isValid(examId)) { res.status(400).json({ message: 'ID bài thi không hợp lệ.' }); return null; }
  const exam = await Exam.findById(examId).select('createdBy title').lean();
  if (!exam) { res.status(404).json({ message: 'Không tìm thấy bài thi.' }); return null; }
  if (user.role !== 'admin' && exam.createdBy !== user.username) {
    res.status(403).json({ message: 'Đây không phải đề thi của bạn.' });
    return null;
  }
  return exam;
}

app.post("/api/exams/:id/exit-log", async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ success: false, message: "Bạn cần đăng nhập." });
  try {
    const log = new ExitLog({
      examId: req.params.id,
      userId: user.username, // lấy từ phiên đăng nhập, không tin dữ liệu gửi lên
      reason: String(req.body.reason || '').slice(0, 200)
    });
    await log.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/exams/:id/exit-log", async (req, res) => {
  try {
    const exam = await getOwnedExam(req, res, req.params.id);
    if (!exam) return;
    const logs = await ExitLog.find({ examId: req.params.id }).sort({ timestamp: -1 });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Kết quả của MỘT đề (chỉ giáo viên chủ đề / admin)
app.get('/api/exams/:examId/results', async (req, res) => {
  try {
    const { examId } = req.params;
    const exam = await getOwnedExam(req, res, examId);
    if (!exam) return;

    const results = await Result.find({ examId }).sort({ createdAt: -1 }).lean();
    if (results.length === 0) return res.json([]);

    const videos = await ExamVideo.find({ examId: new mongoose.Types.ObjectId(examId) }).lean();
    const videoByUser = new Map(videos.map((v) => [v.userId, v.videoUrl]));

    res.json(results.map((r) => ({
      ...r,
      examTitle: exam.title,
      videoUrl: videoByUser.get(r.userId) || null
    })));
  } catch (error) {
    console.error("Lỗi khi tải kết quả:", error);
    res.status(500).json({ message: "Lỗi Server khi tải kết quả." });
  }
});

// Kết quả của TẤT CẢ đề do giáo viên tạo (trước đây nút "Xem tất cả kết quả" gọi route này nhưng nó chưa tồn tại)
app.get('/api/results', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ message: 'Bạn cần đăng nhập.' });
  if (!isStaff(user)) return res.status(403).json({ message: 'Chỉ giáo viên mới có quyền này.' });
  try {
    const exams = await Exam.find(user.role === 'admin' ? {} : { createdBy: user.username }).select('title').lean();
    const titleById = new Map(exams.map((e) => [String(e._id), e.title]));
    const results = await Result.find({ examId: { $in: exams.map((e) => e._id) } })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    res.json(results.map((r) => ({ ...r, examTitle: titleById.get(String(r.examId)) || '' })));
  } catch (err) {
    console.error('Lỗi tải tất cả kết quả:', err);
    res.status(500).json({ message: 'Lỗi server khi tải kết quả.' });
  }
});

// Chấm điểm: điểm phải từ 0 đến 10 và bài phải thuộc đề của giáo viên đó
app.post("/api/results/:id/grade", async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ message: "Bạn cần đăng nhập." });
  if (!isStaff(user)) return res.status(403).json({ message: "Không có quyền" });
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "ID bài làm không hợp lệ." });
  }

  const raw = req.body.score;
  const score = Number(raw);
  if (raw === null || raw === undefined || raw === '' || !Number.isFinite(score) || score < 0 || score > 10) {
    return res.status(400).json({ message: "Điểm phải là số từ 0 đến 10." });
  }

  try {
    const result = await Result.findById(req.params.id);
    if (!result) return res.status(404).json({ message: "Không tìm thấy bài làm." });

    const exam = await getOwnedExam(req, res, String(result.examId));
    if (!exam) return;

    result.score = Math.round(score * 10) / 10;
    result.status = "graded";
    await result.save();
    res.json({ success: true, result });
  } catch (err) {
    console.error("Lỗi chấm điểm:", err);
    res.status(500).json({ message: "Lỗi server khi chấm điểm." });
  }
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


  socket.on("disconnect", () => {
    onlineUsers = Math.max(0, onlineUsers - 1);
    console.log("❌ Người dùng ngắt kết nối:", socket.id, socket.username);
    io.emit("serverMessage", `${socket.username} đã rời khỏi phòng`);
    io.emit("onlineCount", onlineUsers);
  });
});
const AI_SYSTEM_PROMPT = [
  "Bạn là AI Học Tập, trợ lý học tập thân thiện trên nền tảng nộp bài của lớp học.",
  "Luôn trả lời bằng tiếng Việt (trừ khi người dùng yêu cầu ngôn ngữ khác), ngắn gọn, dễ hiểu, giải từng bước khi là bài tập.",
  "Định dạng bằng Markdown: **đậm**, danh sách gạch đầu dòng, bảng khi cần.",
  "Mọi công thức toán/lý/hóa PHẢI viết bằng LaTeX: dùng $...$ cho công thức trong dòng và $$...$$ cho công thức riêng một dòng.",
  "Ví dụ: $x^2 - 5x + 6 = 0$, $$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$. Không dùng \\( \\) hay \\[ \\], không viết công thức dạng chữ thô như x^2 hay sqrt(x).",
  "Khi cần chèn tiền tệ hãy viết bằng chữ (ví dụ: 5 đô la) để không nhầm với ký hiệu công thức."
].join("\n");

app.post("/api/chat", async (req, res) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 4000) : "";
    if (!message) return res.status(400).json({ reply: "⚠️ Bạn chưa nhập câu hỏi." });
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ reply: "⚠️ Server chưa cấu hình GEMINI_API_KEY." });
    }

    // Lịch sử hội thoại (tối đa 10 lượt gần nhất) để AI hiểu ngữ cảnh
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];
    const contents = [];
    for (const h of history) {
      const text = typeof h?.text === "string" ? h.text.slice(0, 4000) : "";
      if (!text) continue;
      const role = h.role === "user" ? "user" : "model";
      if (contents.length && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts[0].text += "\n" + text; // Gemini yêu cầu xen kẽ user/model
      } else {
        contents.push({ role, parts: [{ text }] });
      }
    }
    // Gemini bắt đầu bằng lượt "user"
    while (contents.length && contents[0].role !== "user") contents.shift();
    if (contents.length && contents[contents.length - 1].role === "user") {
      contents[contents.length - 1].parts[0].text += "\n" + message;
    } else {
      contents.push({ role: "user", parts: [{ text: message }] });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 40000);
    let response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: AI_SYSTEM_PROMPT }] },
            contents,
            generationConfig: { temperature: 0.6, maxOutputTokens: 2048 }
          })
        }
      );
    } finally {
      clearTimeout(timer);
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) {
      console.error("Gemini lỗi:", response.status, data?.error?.message);
      const busy = response.status === 429 || response.status === 503;
      return res.status(busy ? 503 : 502).json({
        reply: busy ? "⚠️ AI đang quá tải, bạn thử lại sau ít giây nhé." : "⚠️ AI gặp lỗi, vui lòng thử lại."
      });
    }

    const cand = data?.candidates?.[0];
    let reply = (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
    if (!reply) {
      reply = cand?.finishReason === "SAFETY" || data?.promptFeedback?.blockReason
        ? "⚠️ Mình không thể trả lời nội dung này. Bạn thử hỏi theo cách khác nhé."
        : "⚠️ Không có phản hồi từ AI.";
    }
    res.json({ reply });
  } catch (err) {
    console.error("Lỗi /api/chat:", err);
    const timeout = err?.name === "AbortError";
    res.status(timeout ? 504 : 500).json({
      reply: timeout ? "⏱️ AI phản hồi quá lâu, bạn thử gửi lại nhé." : "⚠️ Lỗi khi gọi AI."
    });
  }
});
// Khởi động server
app.post('/api/submitExam', async (req, res) => {
  try {
    const { examId, answers, shortAnswers, userId } = req.body;

    if (!examId || (!answers && !shortAnswers)) {
      return res.status(400).json({ error: 'Thiếu dữ liệu bài thi.' });
    }

    console.log('📩 Dữ liệu bài thi nhận được:', { examId, userId, answers, shortAnswers });

    // Lưu tạm xuống file (hoặc có thể lưu MongoDB nếu bạn có model)
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, 'data');
    const filePath = path.join(dir, `exam_${examId}.json`);

    fs.mkdirSync(dir, { recursive: true });

    let all = [];
    if (fs.existsSync(filePath)) {
      all = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }

    all.push({
      userId,
      examId,
      answers,
      shortAnswers,
      submittedAt: new Date()
    });

    await ExamSubmission.create({ examId, userId, answers, shortAnswers });


    res.json({ success: true, message: 'Nộp bài thi thành công!' });
  } catch (err) {
    console.error('❌ Lỗi khi nộp bài thi:', err);
    res.status(500).json({ error: 'Lỗi server khi nộp bài thi.' });
  }
});

// API Ngân hàng câu hỏi (đóng góp công khai, giáo viên/admin duyệt)
app.use('/api/question-bank', require('./routes/questionBank'));
// API tổng quan cho giáo viên (phân tích cả lớp)
app.use('/api/teacher', require('./routes/teacher'));
// Bảng xếp hạng và hồ sơ học sinh (dựa trên ngân hàng câu hỏi)
app.use('/api/leaderboard', require('./routes/leaderboard'));
// API bài giảng (giáo viên đăng, mọi người xem)
app.use('/api/lectures', require('./routes/lectures'));

// Route test cho Render nhận biết server đã sẵn sàng
app.get('/', (req, res) => {
  res.send('✅ Server Render đang hoạt động!');
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server đang chạy trên Render - PORT: ${PORT}`);
});