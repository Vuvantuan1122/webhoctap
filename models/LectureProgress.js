// models/LectureProgress.js – học sinh đã học xong bài giảng nào, lúc nào
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  username: { type: String, required: true },
  lectureId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture', required: true },
  completedAt: { type: Date, default: Date.now }
});
schema.index({ username: 1, lectureId: 1 }, { unique: true });

module.exports = mongoose.model('LectureProgress', schema);
