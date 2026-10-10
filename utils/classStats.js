// Phân tích kết quả luyện tập (Ngân hàng câu hỏi) của CẢ LỚP, dành cho giáo viên.
// Hàm thuần (không đụng database) để dễ kiểm thử.

const {
  TYPE_LABEL, levelOf, pct, dayKey, MIN_ATTEMPTS, VN_OFFSET, LEVEL_RANK
} = require("./questionStats");

const INACTIVE_DAYS = 7;     // quá ngần này ngày không luyện tập -> cần nhắc
const MOST_MISSED_MIN = 2;   // câu phải có ít nhất ngần này lượt làm mới xét "hay sai"
const DAY_MS = 86400000;

/**
 * @param attempts     lượt làm bài { username, question, subject, type, isCorrect, createdAt }
 * @param questionMap  Map<id, câu hỏi> các câu còn tồn tại và đã duyệt
 * @param students     mảng username học sinh thuộc phạm vi đang xem (cả lớp hoặc một lớp)
 * @param now          thời điểm hiện tại (ms), để test
 */
function buildClassStats(attempts, questionMap, students, now = Date.now()) {
  const roster = [...new Set(students)];
  const inRoster = new Set(roster);
  const data = attempts.filter((a) => inRoster.has(a.username));

  const total = data.length;
  const correct = data.filter((a) => a.isCorrect).length;

  // ---------- Theo môn / theo dạng (cả lớp) ----------
  const group = (keyFn) => {
    const m = new Map();
    for (const a of data) {
      const k = keyFn(a);
      const g = m.get(k) || { key: k, attempts: 0, correct: 0, who: new Set() };
      g.attempts++;
      if (a.isCorrect) g.correct++;
      g.who.add(a.username);
      m.set(k, g);
    }
    return m;
  };
  const finalize = (g, extra = {}) => {
    const accuracy = pct(g.correct, g.attempts);
    return { attempts: g.attempts, correct: g.correct, students: g.who.size, accuracy, level: levelOf(g.attempts, accuracy), ...extra };
  };
  const bySubject = [...group((a) => a.subject || "Khác").values()]
    .map((g) => finalize(g, { subject: g.key }))
    .sort((x, y) => LEVEL_RANK[x.level] - LEVEL_RANK[y.level] || x.accuracy - y.accuracy);
  const byType = [...group((a) => a.type).values()]
    .map((g) => finalize(g, { type: g.key, label: TYPE_LABEL[g.key] || g.key }))
    .sort((x, y) => LEVEL_RANK[x.level] - LEVEL_RANK[y.level] || x.accuracy - y.accuracy);

  // ---------- Câu cả lớp hay sai nhất ----------
  const perQ = new Map();
  for (const a of data) {
    const id = String(a.question);
    const g = perQ.get(id) || { id, attempts: 0, wrong: 0, wrongBy: new Set(), by: new Set() };
    g.attempts++;
    g.by.add(a.username);
    if (!a.isCorrect) { g.wrong++; g.wrongBy.add(a.username); }
    perQ.set(id, g);
  }
  const mostMissed = [];
  for (const g of perQ.values()) {
    const q = questionMap.get(g.id);
    if (!q || g.wrong === 0 || g.attempts < MOST_MISSED_MIN) continue;
    mostMissed.push({
      _id: g.id,
      subject: q.subject,
      type: q.type,
      question: q.question,
      options: q.options || [],
      correctAnswer: q.correctAnswer,
      explanation: q.explanation || "",
      attempts: g.attempts,
      wrong: g.wrong,
      wrongRate: pct(g.wrong, g.attempts),
      studentsWrong: g.wrongBy.size,
      studentsTried: g.by.size
    });
  }
  mostMissed.sort((x, y) => y.wrongRate - x.wrongRate || y.wrong - x.wrong);

  // ---------- Từng học sinh ----------
  const per = new Map(roster.map((u) => [u, { username: u, attempts: 0, correct: 0, lastAt: null, subj: new Map() }]));
  for (const a of data) {
    const p = per.get(a.username);
    p.attempts++;
    if (a.isCorrect) p.correct++;
    const t = new Date(a.createdAt).getTime();
    if (!p.lastAt || t > p.lastAt) p.lastAt = t;
    const sg = p.subj.get(a.subject || "Khác") || { attempts: 0, correct: 0 };
    sg.attempts++;
    if (a.isCorrect) sg.correct++;
    p.subj.set(a.subject || "Khác", sg);
  }

  const studentRows = [...per.values()].map((p) => {
    const accuracy = pct(p.correct, p.attempts);
    const level = levelOf(p.attempts, accuracy);
    const daysSince = p.lastAt === null ? null : Math.floor((now - p.lastAt) / DAY_MS);
    // Môn yếu nhất của học sinh (cần ít nhất 2 lượt để so sánh)
    let weakest = null;
    for (const [subject, g] of p.subj) {
      if (g.attempts < 2) continue;
      const acc = pct(g.correct, g.attempts);
      if (!weakest || acc < weakest.accuracy) weakest = { subject, accuracy: acc };
    }
    const reasons = [];
    if (p.attempts === 0) reasons.push("never");
    else if (daysSince >= INACTIVE_DAYS) reasons.push("inactive");
    if (level === "weak") reasons.push("weak");
    return {
      username: p.username,
      attempts: p.attempts,
      correct: p.correct,
      accuracy,
      level,
      daysSince,
      lastAt: p.lastAt ? new Date(p.lastAt).toISOString() : null,
      weakest: weakest && weakest.accuracy < 75 ? weakest : null,
      needsAttention: reasons.length > 0,
      reasons
    };
  });
  // Cần chú ý lên trước (yếu nhất, rồi lâu không luyện nhất), còn lại theo độ chính xác tăng dần
  studentRows.sort((x, y) =>
    Number(y.needsAttention) - Number(x.needsAttention) ||
    (x.attempts === 0) - (y.attempts === 0) ||
    x.accuracy - y.accuracy ||
    (y.daysSince ?? 1e9) - (x.daysSince ?? 1e9)
  );

  const activeStudents = studentRows.filter((s) => s.daysSince !== null && s.daysSince < INACTIVE_DAYS).length;
  const neverPracticed = studentRows.filter((s) => s.attempts === 0).length;
  const inactive = studentRows.filter((s) => s.daysSince !== null && s.daysSince >= INACTIVE_DAYS).length;

  // ---------- 7 ngày gần nhất ----------
  const daily = [];
  for (let i = 6; i >= 0; i--) {
    const ms = now - i * DAY_MS;
    const d = new Date(ms + VN_OFFSET);
    daily.push({
      date: dayKey(ms),
      label: `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      attempts: 0,
      correct: 0
    });
  }
  const dayIndex = new Map(daily.map((d, i) => [d.date, i]));
  for (const a of data) {
    const idx = dayIndex.get(dayKey(new Date(a.createdAt).getTime()));
    if (idx === undefined) continue;
    daily[idx].attempts++;
    if (a.isCorrect) daily[idx].correct++;
  }

  // ---------- Gợi ý cho giáo viên ----------
  const suggestions = [];
  if (roster.length === 0) {
    suggestions.push({ tone: "info", text: "Chưa có học sinh nào trong phạm vi này. Hãy duyệt yêu cầu tham gia lớp để bắt đầu theo dõi." });
  } else if (total === 0) {
    suggestions.push({ tone: "info", text: "Học sinh chưa làm câu nào trong Ngân hàng câu hỏi. Hãy giao các em vào luyện tập để có dữ liệu phân tích." });
  } else {
    for (const s of bySubject.filter((x) => x.level === "weak" || x.level === "improve").slice(0, 3)) {
      suggestions.push({
        tone: s.level === "weak" ? "danger" : "warn",
        text: `Môn ${s.subject}: cả lớp đúng ${s.accuracy}% (${s.students} học sinh, ${s.attempts} lượt).` +
          (s.level === "weak" ? " Nên dành thời gian ôn lại phần này trên lớp." : " Nên giao thêm bài luyện cho môn này.")
      });
    }
    for (const q of mostMissed.slice(0, 2)) {
      if (q.wrongRate >= 50 && q.studentsTried >= 2) {
        const text = q.question.length > 70 ? q.question.slice(0, 70) + "..." : q.question;
        suggestions.push({
          tone: "warn",
          text: `Câu "${text}" có ${q.studentsWrong}/${q.studentsTried} học sinh làm sai. Nên giảng lại nội dung này.`
        });
      }
    }
    const needAttn = neverPracticed + inactive;
    if (needAttn > 0) {
      suggestions.push({
        tone: "info",
        text: `${needAttn} học sinh chưa luyện tập hoặc đã quá ${INACTIVE_DAYS} ngày chưa luyện. Có thể nhắc các em vào làm bài.`
      });
    }
    const best = bySubject.filter((x) => x.level === "good").sort((x, y) => y.accuracy - x.accuracy)[0];
    if (best) suggestions.push({ tone: "good", text: `Môn ${best.subject} cả lớp làm tốt (đúng ${best.accuracy}%).` });
    if (suggestions.length === 0) {
      suggestions.push({ tone: "info", text: `Cần thêm dữ liệu để đánh giá: mỗi môn cần ít nhất ${MIN_ATTEMPTS} lượt làm bài.` });
    }
  }

  return {
    overall: {
      attempts: total,
      correct,
      accuracy: pct(correct, total),
      totalStudents: roster.length,
      activeStudents,
      neverPracticed,
      inactive
    },
    bySubject,
    byType,
    mostMissed: mostMissed.slice(0, 10),
    students: studentRows,
    daily,
    suggestions,
    thresholds: { minAttempts: MIN_ATTEMPTS, inactiveDays: INACTIVE_DAYS }
  };
}

module.exports = { buildClassStats };
