// routes/lectures.js – API bài giảng
// - Mọi người dùng đã đăng nhập: xem danh sách
// - Chỉ giáo viên: đăng bài / xoá bài của mình
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Lecture = require('../models/Lecture');

const requireLogin = (req, res, next) => {
  if (!req.session || !req.session.user) return res.status(401).json({ message: 'Bạn cần đăng nhập.' });
  next();
};
const requireTeacher = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.status(403).json({ message: 'Chỉ giáo viên mới được thực hiện thao tác này.' });
  }
  next();
};

const toJSON = (l) => ({
  id: l._id, title: l.title, url: l.url, duration: l.duration || '',
  uploadedBy: l.uploadedBy, createdAt: l.createdAt
});

// Danh sách bài giảng (mới nhất trước)
router.get('/', requireLogin, async (req, res) => {
  try {
    const list = await Lecture.find().sort({ createdAt: -1 }).lean();
    res.json(list.map(toJSON));
  } catch (err) {
    console.error('Lỗi lấy bài giảng:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi tải bài giảng.' });
  }
});

// Giáo viên đăng bài giảng
router.post('/', requireLogin, requireTeacher, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const url = String(req.body.url || '').trim();
    const duration = String(req.body.duration || '').trim().slice(0, 20);
    if (!title) return res.status(400).json({ message: 'Tiêu đề không được để trống.' });
    if (!/^https:\/\//i.test(url)) return res.status(400).json({ message: 'Đường dẫn video không hợp lệ.' });

    // Đã có (ví dụ đồng bộ lại từ máy cũ) thì trả về luôn, không tạo trùng
    const existed = await Lecture.findOne({ url });
    if (existed) return res.json({ lecture: toJSON(existed), duplicated: true });

    const lecture = await Lecture.create({ title, url, duration, uploadedBy: req.session.user.username });
    res.status(201).json({ lecture: toJSON(lecture) });
  } catch (err) {
    console.error('Lỗi đăng bài giảng:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi đăng bài giảng.' });
  }
});

// Giáo viên xoá bài giảng của chính mình
router.delete('/:id', requireLogin, requireTeacher, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'ID không hợp lệ.' });
    const lecture = await Lecture.findById(req.params.id);
    if (!lecture) return res.status(404).json({ message: 'Không tìm thấy bài giảng.' });
    if (lecture.uploadedBy !== req.session.user.username) {
      return res.status(403).json({ message: 'Bạn chỉ có thể xoá bài giảng do chính mình đăng.' });
    }
    await lecture.deleteOne();
    res.json({ message: 'Đã xoá bài giảng.' });
  } catch (err) {
    console.error('Lỗi xoá bài giảng:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi xoá bài giảng.' });
  }
});

module.exports = router;
