const mongoose = require("mongoose");

// Mỗi lần người học trả lời một câu trong Ngân hàng câu hỏi sẽ lưu 1 bản ghi.
// Dùng để phân tích điểm yếu theo môn / dạng câu hỏi.
const QuestionAttemptSchema = new mongoose.Schema({
  username: { type: String, required: true, index: true },
  question: { type: mongoose.Schema.Types.ObjectId, ref: "QuestionBank", required: true },
  subject: { type: String, default: "Khác" },
  type: { type: String, enum: ["tracnghiem", "truefalse", "shortanswer"], required: true },
  isCorrect: { type: Boolean, required: true },
  createdAt: { type: Date, default: Date.now }
});

QuestionAttemptSchema.index({ username: 1, createdAt: -1 });

module.exports = mongoose.model("QuestionAttempt", QuestionAttemptSchema);
