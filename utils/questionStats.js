// Phân tích kết quả làm bài trong Ngân hàng câu hỏi.
// Hàm thuần (không đụng database) để dễ kiểm thử.

const MIN_ATTEMPTS = 3;     // cần ít nhất ngần này lượt mới đánh giá được một môn/dạng
const WEAK_BELOW = 50;      // đúng dưới 50%  -> Yếu
const IMPROVE_BELOW = 75;   // đúng dưới 75%  -> Cần cải thiện
const VN_OFFSET = 7 * 3600 * 1000; // múi giờ Việt Nam (UTC+7)

const TYPE_LABEL = {
  tracnghiem: "Trắc nghiệm",
  truefalse: "Đúng / Sai",
  shortanswer: "Trả lời ngắn"
};

const pct = (c, n) => (n ? Math.round((c * 100) / n) : 0);

function levelOf(attempts, accuracy) {
  if (attempts < MIN_ATTEMPTS) return "insufficient";
  if (accuracy < WEAK_BELOW) return "weak";
  if (accuracy < IMPROVE_BELOW) return "improve";
  return "good";
}

const LEVEL_RANK = { weak: 0, improve: 1, good: 2, insufficient: 3 };

function dayKey(ms) {
  return new Date(ms + VN_OFFSET).toISOString().slice(0, 10);
}

/**
 * @param attempts      mảng lượt làm bài { question, subject, type, isCorrect, createdAt }
 * @param questionMap   Map<string, câu hỏi> các câu còn tồn tại và đã duyệt
 * @param now           thời điểm hiện tại (ms), để test
 */
function buildStats(attempts, questionMap, now = Date.now()) {
  const total = attempts.length;
  const correct = attempts.filter((a) => a.isCorrect).length;

  // --- Gom theo môn và theo dạng câu hỏi ---
  const group = (keyFn) => {
    const m = new Map();
    for (const a of attempts) {
      const k = keyFn(a);
      const g = m.get(k) || { key: k, attempts: 0, correct: 0 };
      g.attempts++;
      if (a.isCorrect) g.correct++;
      m.set(k, g);
    }
    return m;
  };
  const subjMap = group((a) => a.subject || "Khác");
  const typeMap = group((a) => a.type);

  // --- Lần làm GẦN NHẤT của mỗi câu: nếu sai thì đó là câu cần ôn lại ---
  const sorted = [...attempts].sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));
  const latest = new Map();
  const wrongTimes = new Map();
  for (const a of sorted) {
    const id = String(a.question);
    if (!latest.has(id)) latest.set(id, a);
    if (!a.isCorrect) wrongTimes.set(id, (wrongTimes.get(id) || 0) + 1);
  }

  const reviewAll = [];
  for (const [id, a] of latest) {
    if (a.isCorrect) continue;
    const q = questionMap.get(id);
    if (!q) continue; // câu đã bị xóa hoặc không còn được duyệt
    reviewAll.push({
      _id: id,
      subject: q.subject,
      type: q.type,
      question: q.question,
      options: q.options || [],
      correctAnswer: q.correctAnswer,
      explanation: q.explanation || "",
      wrongCount: wrongTimes.get(id) || 1,
      lastAt: a.createdAt
    });
  }
  reviewAll.sort((x, y) => y.wrongCount - x.wrongCount || new Date(y.lastAt) - new Date(x.lastAt));

  const wrongBySubject = new Map();
  for (const r of reviewAll) wrongBySubject.set(r.subject, (wrongBySubject.get(r.subject) || 0) + 1);

  const finalize = (g, extra = {}) => {
    const accuracy = pct(g.correct, g.attempts);
    return { ...g, accuracy, level: levelOf(g.attempts, accuracy), ...extra };
  };

  const bySubject = [...subjMap.values()]
    .map((g) => finalize({ subject: g.key, attempts: g.attempts, correct: g.correct },
      { wrongNow: wrongBySubject.get(g.key) || 0 }))
    .sort((x, y) => LEVEL_RANK[x.level] - LEVEL_RANK[y.level] || x.accuracy - y.accuracy);

  const byType = [...typeMap.values()]
    .map((g) => finalize({ type: g.key, label: TYPE_LABEL[g.key] || g.key, attempts: g.attempts, correct: g.correct }))
    .sort((x, y) => LEVEL_RANK[x.level] - LEVEL_RANK[y.level] || x.accuracy - y.accuracy);

  // --- 7 ngày gần nhất ---
  const daily = [];
  for (let i = 6; i >= 0; i--) {
    const ms = now - i * 86400000;
    const key = dayKey(ms);
    const d = new Date(ms + VN_OFFSET);
    daily.push({
      date: key,
      label: `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      attempts: 0,
      correct: 0
    });
  }
  const dayIndex = new Map(daily.map((d, i) => [d.date, i]));
  for (const a of attempts) {
    const idx = dayIndex.get(dayKey(new Date(a.createdAt).getTime()));
    if (idx === undefined) continue;
    daily[idx].attempts++;
    if (a.isCorrect) daily[idx].correct++;
  }

  // --- Gợi ý cải thiện ---
  const suggestions = [];
  if (total === 0) {
    suggestions.push({
      tone: "info",
      text: "Bạn chưa làm câu nào. Hãy vào Ngân hàng câu hỏi làm vài câu để hệ thống phân tích điểm mạnh, điểm yếu của bạn."
    });
  } else {
    const needWork = bySubject.filter((s) => s.level === "weak" || s.level === "improve").slice(0, 3);
    for (const s of needWork) {
      const wrongPart = s.wrongNow > 0 ? ` Còn ${s.wrongNow} câu làm sai chưa ôn lại, hãy làm lại các câu đó trước.` : "";
      suggestions.push({
        tone: s.level === "weak" ? "danger" : "warn",
        subject: s.subject,
        text: `Môn ${s.subject}: đúng ${s.accuracy}% (${s.correct}/${s.attempts} lượt).` +
          (s.level === "weak" ? " Đây là phần bạn cần ưu tiên ôn tập." : " Bạn đang ở mức khá, cần luyện thêm để vững hơn.") +
          wrongPart
      });
    }
    const weakTypes = byType.filter((t) => t.level === "weak").slice(0, 1);
    for (const t of weakTypes) {
      suggestions.push({
        tone: "warn",
        text: `Dạng "${t.label}" còn yếu (đúng ${t.accuracy}%). Hãy đọc kỹ đề và phần giải thích sau mỗi câu sai.`
      });
    }
    const best = bySubject.filter((s) => s.level === "good").sort((x, y) => y.accuracy - x.accuracy)[0];
    if (best) {
      suggestions.push({ tone: "good", text: `Môn ${best.subject} đang làm rất tốt (đúng ${best.accuracy}%). Hãy giữ phong độ nhé!` });
    }
    const last7 = daily.reduce((n, d) => n + d.attempts, 0);
    if (last7 === 0) {
      suggestions.push({ tone: "info", text: "Bạn chưa luyện tập trong 7 ngày qua. Mỗi ngày vài câu sẽ giúp nhớ lâu hơn." });
    }
    if (suggestions.length === 0 || (needWork.length === 0 && !best)) {
      suggestions.push({
        tone: "info",
        text: `Cần thêm dữ liệu để đánh giá chính xác: mỗi môn cần ít nhất ${MIN_ATTEMPTS} lượt làm bài.`
      });
    }
  }

  return {
    overall: { attempts: total, correct, accuracy: pct(correct, total) },
    bySubject,
    byType,
    daily,
    reviewTotal: reviewAll.length,
    review: reviewAll.slice(0, 15),
    suggestions,
    thresholds: { minAttempts: MIN_ATTEMPTS, weakBelow: WEAK_BELOW, improveBelow: IMPROVE_BELOW }
  };
}

module.exports = { buildStats, TYPE_LABEL, levelOf, pct, dayKey, MIN_ATTEMPTS, WEAK_BELOW, IMPROVE_BELOW, VN_OFFSET, LEVEL_RANK };
