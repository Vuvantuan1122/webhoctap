const mongoose = require("mongoose");

const ResultSchema = new mongoose.Schema({
  examId: { type: mongoose.Schema.Types.ObjectId, ref: "Exam", required: true },
  userId: { type: String, required: true }, // tên học sinh nộp bài
  answers: [mongoose.Schema.Types.Mixed],   // lưu mảng câu trả lời (số, text,...)
  score: { type: Number, default: 0 },
  status: { type: String, default: "pending" }, // pending / graded
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Result", ResultSchema);
