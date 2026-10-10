// models/Lecture.js – Bài giảng do giáo viên đăng, học sinh xem
const mongoose = require('mongoose');

const lectureSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  url: { type: String, required: true, unique: true },   // link video (Cloudinary)
  duration: { type: String, default: '' },                // dạng "m:ss"
  uploadedBy: { type: String, required: true },           // username giáo viên
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Lecture', lectureSchema);
