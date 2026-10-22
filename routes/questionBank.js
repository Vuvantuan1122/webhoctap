const express = require("express");
const mongoose = require("mongoose");
const QuestionBank = require("../models/QuestionBank");
const QuestionAttempt = require("../models/QuestionAttempt");
const { buildStats } = require("../utils/questionStats");
const { isMultiTF, validateTfData, toBit, gradeAuto, TF_STATEMENTS } = require("../utils/scoring");

const router = express.Router();

const TYPES = ["tracnghiem", "truefalse", "shortanswer"];

// Số phương án của câu trắc nghiệm (A, B, C, D)
const MC_OPTION_COUNT = 4;

// Danh sách môn học duy nhất của ngân hàng câu hỏi.
// Muốn thêm/bớt môn thì chỉ cần sửa ở đây, giao diện sẽ tự cập nhật.
const SUBJECTS = [
  "Toán", "Ngữ Văn", "Tiếng Anh", "Vật Lý", "Hóa Học", "Sinh Học",
  "Lịch Sử", "Địa Lý", "GDCD", "Tin Học", "Công Nghệ", "Khác"
];
const isReviewer = (u) => !!u && (u.role === "teacher" || u.role === "admin");

// Chuẩn hóa chuỗi để so sánh đáp án trả lời ngắn (không phân biệt hoa thường, khoảng trắng)
const normText = (t) => String(t ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
function sameShort(user, right) {
  const a = normText(user), b = normText(right);
  if (a === b) return true;
  const na = Number(a.replace(",", ".")), nb = Number(b.replace(",", "."));
  return a !== "" && b !== "" && !isNaN(na) && !isNaN(nb) && na === nb;
}

// Lấy các lượt làm bài gần đây của một người học
const MAX_ATTEMPTS = 3000;
const loadAttempts = (username) =>
  QuestionAttempt.find({ username }).sort({ createdAt: -1 }).limit(MAX_ATTEMPTS).lean();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ message: "Bạn cần đăng nhập." });
  }
  next();
}

function requireReviewer(req, res, next) {
  if (!isReviewer(req.session.user)) {
    return res.status(403).json({ message: "Chỉ giáo viên hoặc admin mới có quyền này." });
  }
  next();
}

// Kiểm tra + chuẩn hóa dữ liệu câu hỏi. Trả về { error } hoặc { data }.
function validateQuestion(body) {
  const question = String(body.question || "").trim();
  const type = body.type;
  const subject = String(body.subject || "").trim();
  const explanation = String(body.explanation || "").trim().slice(0, 1000);

  if (!question) return { error: "Vui lòng nhập nội dung câu hỏi." };
  if (question.length > 2000) return { error: "Nội dung câu hỏi quá dài (tối đa 2000 ký tự)." };
  if (!TYPES.includes(type)) return { error: "Loại câu hỏi không hợp lệ." };
  if (!subject) return { error: "Vui lòng chọn môn học." };
  if (!SUBJECTS.includes(subject)) return { error: "Môn học không hợp lệ." };

  let options = [];
  let correctAnswer;

  if (type === "tracnghiem") {
    options = (Array.isArray(body.options) ? body.options : [])
      .map((o) => String(o || "").trim());
    if (options.length !== MC_OPTION_COUNT || options.some((o) => !o)) {
      return { error: `Câu trắc nghiệm cần đúng ${MC_OPTION_COUNT} phương án (A, B, C, D), không được để trống.` };
    }
    const idx = Number(body.correctAnswer);
    if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) {
      return { error: "Vui lòng chọn đáp án đúng." };
    }
    correctAnswer = idx;
  } else if (type === "truefalse") {
    // Đúng/Sai theo Bộ GD&ĐT: 4 ý a, b, c, d; mỗi ý chọn Đúng (0) hoặc Sai (1)
    options = (Array.isArray(body.options) ? body.options : []).map((o) => String(o || "").trim());
    const tfErr = validateTfData(options, body.correctAnswer);
    if (tfErr) return { error: tfErr };
    correctAnswer = body.correctAnswer.map((v) => toBit(v));
  } else {
    const ans = String(body.correctAnswer || "").trim();
    if (!ans) return { error: "Vui lòng nhập đáp án cho câu trả lời ngắn." };
    if (ans.length > 300) return { error: "Đáp án quá dài (tối đa 300 ký tự)." };
    correctAnswer = ans;
  }

  return { data: { question, type, options, correctAnswer, explanation, subject } };
}

// POST /api/question-bank — ai đăng nhập cũng đóng góp được
router.post("/", requireLogin, async (req, res) => {
  const user = req.session.user;
  const { error, data } = validateQuestion(req.body);
  if (error) return res.status(400).json({ message: error });

  try {
    const reviewer = isReviewer(user);
    const doc = await QuestionBank.create({
      ...data,
      contributor: user.username,
      contributorRole: user.role,
      // Câu của giáo viên/admin được duyệt luôn, còn lại chờ duyệt
      status: reviewer ? "approved" : "pending",
      reviewedBy: reviewer ? user.username : undefined,
      reviewedAt: reviewer ? new Date() : undefined
    });
    res.status(201).json({
      success: true,
      question: doc,
      message: reviewer
        ? "Đã thêm câu hỏi vào ngân hàng."
        : "Đã gửi câu hỏi, vui lòng chờ giáo viên/admin duyệt."
    });
  } catch (err) {
    console.error("Lỗi thêm câu hỏi:", err);
    res.status(500).json({ message: "Lỗi server khi thêm câu hỏi." });
  }
});

// GET /api/question-bank?scope=approved|mine|pending&type=&subject=&q=
router.get("/", requireLogin, async (req, res) => {
  const user = req.session.user;
  const { scope = "approved", type, subject, q } = req.query;
  const filter = {};

  if (scope === "mine") {
    filter.contributor = user.username;
  } else if (scope === "pending") {
    if (!isReviewer(user)) {
      return res.status(403).json({ message: "Chỉ giáo viên hoặc admin mới xem được danh sách chờ duyệt." });
    }
    filter.status = "pending";
  } else {
    filter.status = "approved";
  }

  if (TYPES.includes(type)) filter.type = type;
  if (subject) filter.subject = String(subject);

  // ?wrong=1: chỉ các câu mà lần làm gần nhất của người này là SAI (để ôn lại)
  if (req.query.wrong === "1" && scope === "approved") {
    try {
      const attempts = await loadAttempts(user.username);
      const latest = new Map();
      for (const a of attempts) if (!latest.has(String(a.question))) latest.set(String(a.question), a);
      filter._id = { $in: [...latest.values()].filter((a) => !a.isCorrect).map((a) => a.question) };
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server khi tải câu cần ôn." });
    }
  }
  if (q) {
    const safe = String(q).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.question = { $regex: safe, $options: "i" };
  }

  try {
    const items = await QuestionBank.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    res.json({ success: true, questions: items });
  } catch (err) {
    console.error("Lỗi tải ngân hàng câu hỏi:", err);
    res.status(500).json({ message: "Lỗi server khi tải câu hỏi." });
  }
});

// GET /api/question-bank/subjects
// - subjects: danh sách môn chuẩn (dùng cho form đóng góp và bộ lọc)
// - extra: môn cũ đã có câu hỏi được duyệt nhưng không còn trong danh sách chuẩn
//   (chỉ để bộ lọc vẫn tìm được dữ liệu cũ)
router.get("/subjects", requireLogin, async (req, res) => {
  try {
    const used = await QuestionBank.distinct("subject", { status: "approved" });
    const extra = used.filter((s) => s && !SUBJECTS.includes(s)).sort();
    res.json({ success: true, subjects: SUBJECTS, extra });
  } catch (err) {
    res.status(500).json({ message: "Lỗi server." });
  }
});

// POST /api/question-bank/attempts — ghi nhận một lượt làm bài (server tự chấm đúng/sai)
router.post("/attempts", requireLogin, async (req, res) => {
  const user = req.session.user;
  const { questionId, answer } = req.body;
  if (!mongoose.Types.ObjectId.isValid(questionId)) {
    return res.status(400).json({ message: "ID câu hỏi không hợp lệ." });
  }
  try {
    const q = await QuestionBank.findOne({ _id: questionId, status: "approved" }).lean();
    if (!q) return res.status(404).json({ message: "Không tìm thấy câu hỏi." });

    let isCorrect;
    let points = null, correctStatements = null; // chỉ có với câu Đúng/Sai 4 ý
    if (q.type === "shortanswer") {
      if (typeof answer !== "string" || !answer.trim()) {
        return res.status(400).json({ message: "Thiếu câu trả lời." });
      }
      isCorrect = sameShort(answer, q.correctAnswer);
    } else if (isMultiTF(q)) {
      if (!Array.isArray(answer) || answer.length !== TF_STATEMENTS || answer.some((v) => toBit(v) === null)) {
        return res.status(400).json({ message: "Hãy chọn Đúng/Sai cho cả 4 ý." });
      }
      const g = gradeAuto(q, answer);
      isCorrect = g.full;
      points = g.points;
      correctStatements = g.correctCount;
    } else {
      const idx = Number(answer);
      if (!Number.isInteger(idx) || idx < 0 || idx >= q.options.length) {
        return res.status(400).json({ message: "Phương án không hợp lệ." });
      }
      isCorrect = idx === Number(q.correctAnswer);
    }

    await QuestionAttempt.create({
      username: user.username,
      question: q._id,
      subject: q.subject,
      type: q.type,
      isCorrect
    });
    res.status(201).json({ success: true, isCorrect, points, correctStatements });
  } catch (err) {
    console.error("Lỗi ghi nhận lượt làm bài:", err);
    res.status(500).json({ message: "Lỗi server khi lưu kết quả." });
  }
});

// GET /api/question-bank/stats/me — phân tích điểm yếu của chính người đang đăng nhập
router.get("/stats/me", requireLogin, async (req, res) => {
  try {
    const attempts = await loadAttempts(req.session.user.username);
    const ids = [...new Set(attempts.map((a) => String(a.question)))];
    const questions = ids.length
      ? await QuestionBank.find({ _id: { $in: ids }, status: "approved" }).lean()
      : [];
    const map = new Map(questions.map((q) => [String(q._id), q]));
    res.json({ success: true, ...buildStats(attempts, map) });
  } catch (err) {
    console.error("Lỗi thống kê:", err);
    res.status(500).json({ message: "Lỗi server khi phân tích kết quả." });
  }
});

// PUT /api/question-bank/:id/review — chỉ giáo viên/admin duyệt
router.put("/:id/review", requireLogin, requireReviewer, async (req, res) => {
  const { id } = req.params;
  const { action, note } = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "ID không hợp lệ." });
  }
  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ message: "Hành động không hợp lệ." });
  }

  try {
    const doc = await QuestionBank.findById(id);
    if (!doc) return res.status(404).json({ message: "Không tìm thấy câu hỏi." });

    doc.status = action === "approve" ? "approved" : "rejected";
    doc.reviewedBy = req.session.user.username;
    doc.reviewedAt = new Date();
    doc.reviewNote = String(note || "").trim().slice(0, 500);
    await doc.save();

    res.json({
      success: true,
      question: doc,
      message: action === "approve" ? "Đã duyệt câu hỏi." : "Đã từ chối câu hỏi."
    });
  } catch (err) {
    console.error("Lỗi duyệt câu hỏi:", err);
    res.status(500).json({ message: "Lỗi server khi duyệt câu hỏi." });
  }
});

// DELETE /api/question-bank/:id — chủ câu hỏi (khi chưa duyệt) hoặc giáo viên/admin
router.delete("/:id", requireLogin, async (req, res) => {
  const user = req.session.user;
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "ID không hợp lệ." });
  }

  try {
    const doc = await QuestionBank.findById(id);
    if (!doc) return res.status(404).json({ message: "Không tìm thấy câu hỏi." });

    const isOwner = doc.contributor === user.username;
    if (!isReviewer(user) && !(isOwner && doc.status !== "approved")) {
      return res.status(403).json({ message: "Bạn không có quyền xóa câu hỏi này." });
    }

    await doc.deleteOne();
    res.json({ success: true, message: "Đã xóa câu hỏi." });
  } catch (err) {
    console.error("Lỗi xóa câu hỏi:", err);
    res.status(500).json({ message: "Lỗi server khi xóa câu hỏi." });
  }
});

module.exports = router;
