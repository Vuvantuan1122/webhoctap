// routes/lectures.js – API bài giảng
// - Mọi người dùng đã đăng nhập: xem danh sách
// - Chỉ giáo viên: đăng bài / xoá bài của mình
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Lecture = require('../models/Lecture');
const Classroom = require('../models/Classroom');
const LectureProgress = require('../models/LectureProgress');

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

// Lấy ID video từ mọi dạng link YouTube (watch?v=, youtu.be, shorts, embed, live)
const ytId = (u) => {
  try {
    const x = new URL(u);
    const host = x.hostname.replace(/^(www|m)\./, '');
    let id = null;
    if (host === 'youtu.be') id = x.pathname.split('/')[1];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      id = x.searchParams.get('v');
      if (!id) {
        const m = x.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{11})/);
        if (m) id = m[2];
      }
    }
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch {
    return null;
  }
};

const toJSON = (l) => ({
  id: l._id, title: l.title, url: l.url, duration: l.duration || '',
  uploadedBy: l.uploadedBy, createdAt: l.createdAt,
  path: l.path || '', section: l.section || '',
  classIds: (l.classIds || []).map(String)
});

const clean = v => String(v || '').trim().slice(0, 100);
// Chỉ cho gán vào lớp của chính giáo viên này (null = có lớp không thuộc quyền)
const ownClassIds = async (raw, teacher) => {
  const ids = Array.isArray(raw) ? raw.filter(id => mongoose.Types.ObjectId.isValid(id)) : [];
  if (!ids.length) return [];
  const own = await Classroom.find({ _id: { $in: ids }, teacherUsername: teacher }).select('_id').lean();
  return own.length === new Set(ids.map(String)).size ? own.map(c => c._id) : null;
};

// Danh sách bài giảng (mới nhất trước)
// - Học sinh: bài chưa gán lớp (cho mọi người) + bài của các lớp mình đã tham gia
// - Giáo viên: bài do mình đăng + bài chưa gán lớp
router.get('/', requireLogin, async (req, res) => {
  try {
    const u = req.session.user;
    const noClass = { $or: [{ classIds: { $exists: false } }, { classIds: { $size: 0 } }] };
    let filter;
    if (u.role === 'teacher') {
      filter = { $or: [{ uploadedBy: u.username }, noClass] };
    } else {
      const mine = await Classroom.find({ students: u.username }).select('_id').lean();
      filter = { $or: [noClass, { classIds: { $in: mine.map(c => c._id) } }] };
    }
    const list = await Lecture.find(filter).sort({ createdAt: 1 }).lean();   // cũ → mới: đúng thứ tự học
    res.json(list.map(toJSON));
  } catch (err) {
    console.error('Lỗi lấy bài giảng:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi tải bài giảng.' });
  }
});

// Tiến độ học của người dùng hiện tại
router.get('/progress', requireLogin, async (req, res) => {
  try {
    const rows = await LectureProgress.find({ username: req.session.user.username }).lean();
    res.json(rows.map(r => ({ lectureId: String(r.lectureId), completedAt: r.completedAt })));
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ khi tải tiến độ.' });
  }
});

// Đánh dấu đã học / bỏ đánh dấu
router.post('/:id/progress', requireLogin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'ID không hợp lệ.' });
    const username = req.session.user.username, lectureId = req.params.id;
    if (req.body.done === false) {
      await LectureProgress.deleteOne({ username, lectureId });
      return res.json({ done: false });
    }
    if (!(await Lecture.exists({ _id: lectureId }))) return res.status(404).json({ message: 'Không tìm thấy bài giảng.' });
    const row = await LectureProgress.findOneAndUpdate({ username, lectureId }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true, new: true });
    res.json({ done: true, completedAt: row.completedAt });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi máy chủ khi lưu tiến độ.' });
  }
});

// Giáo viên đăng bài giảng
router.post('/', requireLogin, requireTeacher, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    let url = String(req.body.url || '').trim();
    const duration = String(req.body.duration || '').trim().slice(0, 20);
    if (!title) return res.status(400).json({ message: 'Tiêu đề không được để trống.' });
    // Link YouTube → chuẩn hoá về 1 dạng duy nhất để không bị đăng trùng
    const vid = ytId(url);
    if (vid) url = `https://www.youtube.com/watch?v=${vid}`;
    else if (!/^https:\/\//i.test(url)) return res.status(400).json({ message: 'Đường dẫn video không hợp lệ.' });

    const classIds = await ownClassIds(req.body.classIds, req.session.user.username);
    if (classIds === null) return res.status(403).json({ message: 'Bạn chỉ có thể đăng cho lớp của mình.' });
    const path = clean(req.body.path), section = clean(req.body.section);

    // Đã có (ví dụ đồng bộ lại từ máy cũ) thì trả về luôn, không tạo trùng
    const existed = await Lecture.findOne({ url, uploadedBy: req.session.user.username });
    if (existed) return res.json({ lecture: toJSON(existed), duplicated: true });

    const lecture = await Lecture.create({ title, url, duration, classIds, path, section, uploadedBy: req.session.user.username });
    res.status(201).json({ lecture: toJSON(lecture) });
  } catch (err) {
    console.error('Lỗi đăng bài giảng:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi đăng bài giảng.' });
  }
});

// Giáo viên sửa bài giảng của mình (tiêu đề, lộ trình, phần, lớp)
router.patch('/:id', requireLogin, requireTeacher, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'ID không hợp lệ.' });
    const lecture = await Lecture.findById(req.params.id);
    if (!lecture) return res.status(404).json({ message: 'Không tìm thấy bài giảng.' });
    if (lecture.uploadedBy !== req.session.user.username) return res.status(403).json({ message: 'Bạn chỉ có thể sửa bài giảng do chính mình đăng.' });
    const b = req.body || {};
    if (b.title !== undefined) {
      const t = String(b.title).trim();
      if (!t) return res.status(400).json({ message: 'Tiêu đề không được để trống.' });
      lecture.title = t.slice(0, 200);
    }
    if (b.path !== undefined) lecture.path = clean(b.path);
    if (b.section !== undefined) lecture.section = clean(b.section);
    if (b.classIds !== undefined) {
      const ids = await ownClassIds(b.classIds, req.session.user.username);
      if (ids === null) return res.status(403).json({ message: 'Bạn chỉ có thể đăng cho lớp của mình.' });
      lecture.classIds = ids;
    }
    await lecture.save();
    res.json({ lecture: toJSON(lecture) });
  } catch (err) {
    console.error('Lỗi sửa bài giảng:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi sửa bài giảng.' });
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
    await LectureProgress.deleteMany({ lectureId: lecture._id });
    res.json({ message: 'Đã xoá bài giảng.' });
  } catch (err) {
    console.error('Lỗi xoá bài giảng:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi xoá bài giảng.' });
  }
});

module.exports = router;
