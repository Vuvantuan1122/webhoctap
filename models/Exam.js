const mongoose = require("mongoose");

const QuestionSchema = new mongoose.Schema({
  question: String,
  options: [String],
  correctAnswer: Number,
  type: { type: String, enum: ["tracnghiem", "truefalse", "shortanswer"], default: "tracnghiem" }
});

const ExamSchema = new mongoose.Schema({
  title: String,
  subject: String,
  duration: Number,
  passage: String, // ✅ thêm đoạn văn đọc hiểu
  questions: [QuestionSchema],
  createdBy: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Exam", ExamSchema);
