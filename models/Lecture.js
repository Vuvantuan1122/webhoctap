// models/Lecture.js – Bài giảng do giáo viên đăng, học sinh xem
const mongoose = require('mongoose');

const lectureSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  url: { type: String, required: true },                  // link video (YouTube/Cloudinary)
  duration: { type: String, default: '' },                // dạng "m:ss"
  uploadedBy: { type: String, required: true },           // username giáo viên
  path: { type: String, default: '', trim: true, maxlength: 100 },    // lộ trình (khóa học)
  section: { type: String, default: '', trim: true, maxlength: 100 }, // phần / chương trong lộ trình
  classIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Classroom' }], // rỗng = hiện cho mọi học sinh
  createdAt: { type: Date, default: Date.now }
});

// Cùng 1 video có thể được các giáo viên khác nhau đăng; mỗi giáo viên chỉ 1 bản (chọn nhiều lớp trong bản đó)
lectureSchema.index({ url: 1, uploadedBy: 1 }, { unique: true });

const Lecture = mongoose.model('Lecture', lectureSchema);
// Bỏ chỉ mục unique cũ trên url (nếu còn) để cho phép tính năng chia lớp
Lecture.on('index', () => { Lecture.collection.dropIndex('url_1').catch(() => {}); });

module.exports = Lecture;
