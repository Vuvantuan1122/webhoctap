const mongoose = require("mongoose");

const examVideoSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true, // username hoặc _id của học sinh
  },
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Exam",
    required: true, // Liên kết với bài thi
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Classroom",
  },
  videoUrl: {
    type: String,
    required: true, // Đường dẫn video Cloudinary
  },
  uploadedAt: {
    type: Date,
    default: Date.now, // Tự động ghi thời gian upload
  },
});

module.exports = mongoose.model("ExamVideo", examVideoSchema);
