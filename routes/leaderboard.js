const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/user");
const Classroom = require("../models/Classroom");
const QuestionAttempt = require("../models/QuestionAttempt");
const LB = require("../utils/leaderboard");

const router = express.Router();

const PERIODS = ["week", "month", "all"];
const SORTS = ["score", "accuracy", "answered"];
const TOP_N = 50;              // số dòng tối đa của bảng xếp hạng
const MAX_ATTEMPTS = 300000;   // chặn trên số lượt làm bài nạp vào bộ nhớ
const CACHE_MS = 30 * 1000;    // kết quả được dùng lại trong 30 giây

const cache = new Map();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ message: "Bạn cần đăng nhập." });
  }
  next();
}

// Thống kê của MỌI học sinh cho một kỳ (và một môn). Dùng chung cho bảng xếp hạng và hồ sơ.
async function getStats(period, subject, now = Date.now()) {
  const key = period + "|" + subject;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit;

  // Chỉ lấy username/trường/lớp, KHÔNG lấy email hay mật khẩu
  const users = await User.find({ role: "student" }).select("username school class").lean();
  const students = new Map(users.map((u) => [u.username, { school: u.school, class: u.class }]));

  const filter = { username: { $in: [...students.keys()] } };
  const start = LB.periodStart(period, now);
  if (start !== null) filter.createdAt = { $gte: new Date(start) };
  if (subject) filter.subject = subject;

  const attempts = await QuestionAttempt.find(filter)
    .select("username question subject isCorrect createdAt")
    .sort({ createdAt: 1 })
    .limit(MAX_ATTEMPTS)
    .lean();

  const value = { at: now, stats: LB.computeStats(attempts, students) };
  cache.set(key, value);
  return value;
}

// GET /api/leaderboard?period=week|month|all&sort=score|accuracy|answered&scope=all|class&classId=&subject=
router.get("/", requireLogin, async (req, res) => {
  const user = req.session.user;
  const period = PERIODS.includes(req.query.period) ? req.query.period : "all";
  const sort = SORTS.includes(req.query.sort) ? req.query.sort : "score";
  const scope = req.query.scope === "class" ? "class" : "all";
  const subject = typeof req.query.subject === "string" ? req.query.subject.trim().slice(0, 60) : "";

  try {
    // Các lớp của người đang xem (học sinh: lớp đang học; giáo viên: lớp mình dạy)
    const mine = user.role === "teacher" ? { teacherUsername: user.username }
      : user.role === "student" ? { students: user.username } : null;
    const classes = mine ? await Classroom.find(mine).select("name students").lean() : [];

    const data = await getStats(period, subject);
    let pool = data.stats;
    let classId = null;

    if (scope === "class") {
      let chosen = classes;
      if (req.query.classId) {
        if (!mongoose.Types.ObjectId.isValid(req.query.classId)) {
          return res.status(400).json({ message: "ID lớp không hợp lệ." });
        }
        chosen = classes.filter((c) => String(c._id) === String(req.query.classId));
        if (chosen.length === 0) {
          return res.status(403).json({ message: "Bạn không có quyền xem lớp này." });
        }
        classId = String(chosen[0]._id);
      }
      const members = new Set(chosen.flatMap((c) => c.students || []));
      pool = pool.filter((s) => members.has(s.username));
    }

    const ranked = LB.rankBoard(pool, sort);
    const minNeeded = sort === "accuracy" ? LB.MIN_ACCURACY_BOARD : LB.MIN_RANKED;
    const pick = (s) => ({
      rank: s.rank, username: s.username, school: s.school, class: s.class,
      answered: s.answered, correct: s.correct, accuracy: s.accuracy, score: s.score
    });

    let me = null;
    if (user.role === "student") {
      const mineRanked = ranked.find((r) => r.username === user.username);
      const raw = pool.find((s) => s.username === user.username);
      me = mineRanked
        ? { ranked: true, ...pick(mineRanked), total: ranked.length }
        : { ranked: false, answered: raw ? raw.answered : 0, needed: minNeeded };
    }

    res.json({
      success: true,
      meta: {
        period, sort, scope, classId, subject,
        minRanked: minNeeded,
        totalRanked: ranked.length,
        updatedAt: new Date(data.at).toISOString()
      },
      classes: classes.map((c) => ({ _id: c._id, name: c.name })),
      rows: ranked.slice(0, TOP_N).map((r) => ({ ...pick(r), isMe: r.username === user.username })),
      me
    });
  } catch (err) {
    console.error("Lỗi bảng xếp hạng:", err);
    res.status(500).json({ message: "Lỗi server khi tải bảng xếp hạng." });
  }
});

// GET /api/leaderboard/profile/:username  (dùng "me" để xem hồ sơ của chính mình)
router.get("/profile/:username", requireLogin, async (req, res) => {
  const viewer = req.session.user;
  let username = String(req.params.username || "").trim();
  if (username === "me") username = viewer.username;
  if (!username || username.length > 100) {
    return res.status(400).json({ message: "Tên người dùng không hợp lệ." });
  }

  try {
    // Không bao giờ lấy email/mật khẩu: hồ sơ này ai đăng nhập cũng xem được
    const u = await User.findOne({ username }).select("username role school class").lean();
    if (!u) return res.status(404).json({ message: "Không tìm thấy người dùng này." });

    const base = {
      username: u.username,
      role: u.role,
      school: u.school || "",
      class: u.class || "",
      isSelf: u.username === viewer.username,
      isStudent: u.role === "student",
      minRanked: LB.MIN_RANKED
    };

    if (u.role !== "student") {
      return res.json({ success: true, profile: { ...base, stats: null, ranked: false, ranks: {}, badges: [], subjects: [], strongest: null, activity: [], streak: null, firstSeen: null, lastActive: null } });
    }

    const attempts = await QuestionAttempt.find({ username })
      .select("question subject isCorrect createdAt")
      .sort({ createdAt: 1 })
      .limit(20000)
      .lean();
    const p = LB.buildProfileStats(attempts);

    const ranks = {};
    for (const period of PERIODS) {
      const d = await getStats(period, "");
      const ranked = LB.rankBoard(d.stats, "score");
      const mine = ranked.find((r) => r.username === username);
      ranks[period] = mine ? { rank: mine.rank, total: ranked.length } : null;
    }

    res.json({
      success: true,
      profile: {
        ...base,
        stats: { answered: p.answered, correct: p.correct, accuracy: p.accuracy, score: p.score },
        ranked: p.answered >= LB.MIN_RANKED,
        ranks,
        badges: LB.buildBadges(p, ranks),
        subjects: p.subjects,
        strongest: p.strongest,
        activity: p.activity,
        streak: p.streak,
        firstSeen: p.firstSeen,
        lastActive: p.lastActive
      }
    });
  } catch (err) {
    console.error("Lỗi hồ sơ:", err);
    res.status(500).json({ message: "Lỗi server khi tải hồ sơ." });
  }
});

router._clearCache = () => cache.clear(); // dùng cho kiểm thử

module.exports = router;
