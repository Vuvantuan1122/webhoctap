const express = require("express");
const router = express.Router();
const Classroom = require("../models/Classroom"); 
// Đảm bảo file model của bạn là Classroom.js

// ✅ Giáo viên tạo lớp
router.post("/create", async (req, res) => {
  try {
    const user = req.session.user;
    if (!user || user.role !== "teacher") {
      return res.status(403).json({ message: "Chỉ giáo viên mới được tạo lớp" });
    }

    const { name, subject, description, joinCode } = req.body;
    
    // Tạo một mã tham gia ngẫu nhiên nếu không có
    const finalJoinCode = joinCode || Math.random().toString(36).substring(2, 8).toUpperCase();

    const newClass = new Classroom({
      name,
      subject,
      description,
      // 🔥 SỬA: Thay teacherUsername bằng teacher (khớp với logic server.js)
      teacher: user.username, 
      students: [], // Khởi tạo mảng students là rỗng (mảng này chứa status: pending/approved)
      joinCode: finalJoinCode 
    });

    await newClass.save();
    res.json({ success: true, class: newClass });
  } catch (err) {
    console.error(err);
    // Xử lý lỗi trùng lặp joinCode hoặc tên lớp
    if (err.code === 11000) {
      return res.status(400).json({ message: "Tên lớp hoặc Mã tham gia đã tồn tại." });
    }
    res.status(500).json({ message: "Lỗi khi tạo lớp học" });
  }
});

// ✅ Học sinh xem danh sách lớp đã tham gia (hoặc đang chờ)
router.get("/my", async (req, res) => {
    const user = req.session.user;
    if (!user) {
        return res.status(401).json({ message: "Chưa đăng nhập." });
    }

    try {
        let classes;
        if (user.role === "teacher") {
            // Giáo viên xem lớp của mình
            classes = await Classroom.find({ teacher: user.username });
        } else {
            // Học sinh xem lớp mình đã tham gia hoặc đang chờ duyệt
            classes = await Classroom.find({
                "students.username": user.username 
            });
        }
        res.json(classes);
    } catch (error) {
        console.error("Lỗi khi tải danh sách lớp:", error);
        res.status(500).json({ message: "Lỗi máy chủ." });
    }
});


// ✅ Học sinh xin vào lớp bằng ID (route này đã có và giữ nguyên)
router.post("/:classId/join", async (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== "student") {
    return res.status(403).json({ message: "Chỉ học sinh mới có thể xin vào lớp" });
  }

  const classroom = await Classroom.findById(req.params.classId);
  if (!classroom) return res.status(404).json({ message: "Không tìm thấy lớp học" });

  // Kiểm tra xem học sinh đã có trong mảng students chưa
  const exists = classroom.students.find(s => s.username === user.username);
  if (exists) return res.status(400).json({ message: "Bạn đã xin hoặc đã trong lớp" });

  // ✅ ĐÚNG: Push object { username, status } vào mảng students
  classroom.students.push({ username: user.username, status: "pending" });
  await classroom.save();

  res.json({ message: "✅ Đã gửi yêu cầu tham gia lớp" });
});

// ✅ Học sinh xin vào lớp bằng Code (Bổ sung tiện lợi hơn cho người dùng)
router.post("/join-by-code", async (req, res) => {
    const user = req.session.user;
    if (!user || user.role !== "student") {
        return res.status(403).json({ message: "Chỉ học sinh mới có thể xin vào lớp" });
    }
    const { joinCode } = req.body;
    if (!joinCode) return res.status(400).json({ message: "Vui lòng cung cấp mã tham gia." });

    try {
        const classroom = await Classroom.findOne({ joinCode: joinCode.toUpperCase() });
        if (!classroom) return res.status(404).json({ message: "Mã lớp học không hợp lệ." });

        const exists = classroom.students.find(s => s.username === user.username);
        if (exists) return res.status(400).json({ message: "Bạn đã xin hoặc đã trong lớp." });

        classroom.students.push({ username: user.username, status: "pending" });
        await classroom.save();
        
        res.json({ message: `✅ Đã gửi yêu cầu tham gia lớp ${classroom.name}` });
    } catch (error) {
        console.error("Lỗi khi tham gia bằng code:", error);
        res.status(500).json({ message: "Lỗi máy chủ." });
    }
});


// ✅ Giáo viên duyệt học sinh (route này đã có và giữ nguyên)
router.post("/:classId/approve/:studentUsername", async (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== "teacher") {
    return res.status(403).json({ message: "Không có quyền duyệt" });
  }

  const classroom = await Classroom.findById(req.params.classId);
  if (!classroom) return res.status(404).json({ message: "Không tìm thấy lớp học" });

  if (classroom.teacher !== user.username) // 🔥 Kiểm tra trường teacher đã sửa
    return res.status(403).json({ message: "Không phải giáo viên của lớp này" });

  // Tìm học sinh trong mảng students
  const student = classroom.students.find(s => s.username === req.params.studentUsername);
  if (!student) return res.status(404).json({ message: "Không tìm thấy học sinh" });

  // ✅ ĐÚNG: Cập nhật status trong object student
  student.status = "approved";
  await classroom.save();

  res.json({ message: `✅ Đã duyệt ${student.username}` });
});

// ✅ Lấy danh sách học sinh trong lớp (giữ nguyên logic)
router.get("/:classId/students", async (req, res) => {
  const classroom = await Classroom.findById(req.params.classId);
  if (!classroom) return res.status(404).json({ message: "Không tìm thấy lớp" });
  // Trả về toàn bộ mảng students (bao gồm status pending/approved)
  res.json(classroom.students); 
});

module.exports = router;