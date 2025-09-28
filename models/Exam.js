const mongoose = require("mongoose");

const QuestionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options: [String],
  correctAnswer: { type: mongoose.Schema.Types.Mixed, default: null },
  type: { 
    type: String, 
    enum: ["tracnghiem", "truefalse", "shortanswer"], 
    default: "tracnghiem" 
  }
});

const ExamSchema = new mongoose.Schema({
  title: { type: String, required: true },
  subject: String,
  duration: Number, // phút
  questions: [QuestionSchema],
  createdBy: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Exam", ExamSchema);
