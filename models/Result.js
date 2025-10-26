const mongoose = require("mongoose");

const ResultSchema = new mongoose.Schema({
  examId: { type: mongoose.Schema.Types.ObjectId, ref: "Exam", required: true },
  userId: { type: String, required: true },
  answers: [mongoose.Schema.Types.Mixed],

  /* Điểm tự động & thời gian bắt đầu */
  autoScore: { type: Number, default: null },   // null = chưa chấm tự động
  startedAt: { type: Date, default: null },     // null = chưa bắt đầu

  score: { type: Number, default: 0 },          // điểm cuối cùng (giáo viên có thể ghi đè)
  status: { type: String, default: "pending" }, // pending / graded
  createdAt: { type: Date, default: Date.now }  // lúc nộp bài
});

module.exports = mongoose.model("Result", ResultSchema);