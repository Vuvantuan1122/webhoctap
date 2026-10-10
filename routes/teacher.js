const express = require("express");
const mongoose = require("mongoose");
const Classroom = require("../models/Classroom");
const Exam = require("../models/Exam");
const QuestionBank = require("../models/QuestionBank");
const QuestionAttempt = require("../models/QuestionAttempt");
const { buildClassStats } = require("../utils/classStats");

const router = express.Router();
const MAX_ATTEMPTS = 10000;

function requireTeacher(req, res, next) {
  const user = req.session && req.session.user;
  if (!user) return res.status(401).json({ message: "Bạn cần đăng nhập." });
  if (user.role !== "teacher" && user.role !== "admin") {
    return res.status(403).json({ message: "Chỉ giáo viên mới xem được trang này." });
  }
  next();
}

// GET /api/teacher/overview?classId=<id>
// - Số liệu vận hành (lớp, học sinh, đề thi, việc chờ duyệt) luôn tính trên TẤT CẢ lớp của giáo viên
// - Phần phân tích luyện tập tính theo lớp đang chọn (classId) hoặc tất cả lớp
router.get("/overview", requireTeacher, async (req, res) => {
  const user = req.session.user;
  const { classId } = req.query;

  try {
    const mine = user.role === "admin" ? {} : { teacherUsername: user.username };
    const classrooms = await Classroom.find(mine).sort({ createdAt: -1 }).lean();

    let scope = classrooms;
    if (classId) {
      if (!mongoose.Types.ObjectId.isValid(classId)) {
        return res.status(400).json({ message: "ID lớp không hợp lệ." });
      }
      scope = classrooms.filter((c) => String(c._id) === String(classId));
      if (scope.length === 0) {
        return res.status(403).json({ message: "Bạn không có quyền xem lớp này." });
      }
    }

    const allStudents = new Set(classrooms.flatMap((c) => c.students || []));
    const scopeStudents = [...new Set(scope.flatMap((c) => c.students || []))];

    const [examCount, pendingQuestions] = await Promise.all([
      Exam.countDocuments(user.role === "admin" ? {} : { createdBy: user.username }),
      QuestionBank.countDocuments({ status: "pending" })
    ]);

    const totals = {
      classes: classrooms.length,
      students: allStudents.size,
      exams: examCount,
      pendingJoin: classrooms.reduce((n, c) => n + (c.pendingStudents || []).length, 0),
      pendingQuestions
    };

    let analysis = buildClassStats([], new Map(), scopeStudents);
    if (scopeStudents.length > 0) {
      const attempts = await QuestionAttempt.find({ username: { $in: scopeStudents } })
        .sort({ createdAt: -1 })
        .limit(MAX_ATTEMPTS)
        .lean();
      const ids = [...new Set(attempts.map((a) => String(a.question)))];
      const questions = ids.length
        ? await QuestionBank.find({ _id: { $in: ids }, status: "approved" }).lean()
        : [];
      const map = new Map(questions.map((q) => [String(q._id), q]));
      analysis = buildClassStats(attempts, map, scopeStudents);
    }

    res.json({
      success: true,
      totals,
      classes: classrooms.map((c) => ({
        _id: c._id,
        name: c.name,
        students: (c.students || []).length,
        pending: (c.pendingStudents || []).length
      })),
      selectedClassId: classId || null,
      ...analysis
    });
  } catch (err) {
    console.error("Lỗi tổng quan giáo viên:", err);
    res.status(500).json({ message: "Lỗi server khi tải tổng quan." });
  }
});

module.exports = router;
