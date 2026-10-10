const mongoose = require("mongoose");

const QuestionBankSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ["tracnghiem", "truefalse", "shortanswer"],
    required: true
  },
  options: [String],
  // tracnghiem/truefalse: chỉ số đáp án đúng (Number); shortanswer: chuỗi đáp án
  correctAnswer: { type: mongoose.Schema.Types.Mixed },
  explanation: { type: String, default: "" },
  subject: { type: String, default: "Khác", trim: true },

  // Người đóng góp
  contributor: { type: String, required: true },
  contributorRole: { type: String, default: "student" },

  // Trạng thái duyệt
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
    index: true
  },
  reviewedBy: String,
  reviewedAt: Date,
  reviewNote: { type: String, default: "" },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("QuestionBank", QuestionBankSchema);
