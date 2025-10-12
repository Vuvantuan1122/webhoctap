const mongoose = require("mongoose");

// ✅ 1. ĐỊNH NGHĨA QuestionSchema TRƯỚC
const QuestionSchema = new mongoose.Schema({
  question: String,
  options: [String],
  correctAnswer: Number, // Dùng cho trắc nghiệm
  type: { type: String, enum: ["tracnghiem", "truefalse", "shortanswer"], default: "tracnghiem" }
});

// ✅ 2. SỬ DỤNG QuestionSchema trong ExamSchema SAU
const ExamSchema = new mongoose.Schema({
  title: String,
  subject: String,
  duration: Number,
  passage: String, 
  questions: [QuestionSchema], // Lúc này QuestionSchema đã được định nghĩa
  createdBy: String,
  createdAt: { type: Date, default: Date.now },
  // ✅ TRƯỜNG ĐÃ THÊM: Dùng cho việc phân bổ đề thi theo lớp
  classrooms: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Classroom' }] 
});

module.exports = mongoose.model("Exam", ExamSchema);