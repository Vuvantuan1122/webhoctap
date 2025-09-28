const mongoose = require("mongoose");

const ResultSchema = new mongoose.Schema({
  examId: { type: mongoose.Schema.Types.ObjectId, ref: "Exam", required: true },
  userId: { type: String, required: true },
  answers: [mongoose.Schema.Types.Mixed],   // ✅ cho phép mọi kiểu dữ liệu
  score: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Result", ResultSchema);