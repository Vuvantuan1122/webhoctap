// BẢNG XẾP HẠNG & HỒ SƠ dựa trên các câu đã làm trong Ngân hàng câu hỏi.
// Hàm thuần (không đụng database) để dễ kiểm thử.
//
// CÁCH TÍNH ĐIỂM
//  - Mỗi câu hỏi chỉ tính LẦN LÀM ĐẦU TIÊN của học sinh (làm lại một câu dễ nhiều lần không tăng điểm).
//  - Điểm xếp hạng = ĐỘ CHÍNH XÁC ĐÁNG TIN x HỆ SỐ CHĂM CHỈ  (thang 0 - 100)
//      * Độ chính xác đáng tin = cận dưới khoảng tin cậy 95% (Wilson) của tỉ lệ đúng:
//        làm ít câu thì bị trừ vì chưa đủ cơ sở kết luận (3/3 câu may mắn không thể đứng đầu).
//      * Hệ số chăm chỉ tăng dần theo số câu đã làm và đạt tối đa (100%) khi làm FULL_VOLUME = 100 câu.
//      * Ví dụ: 10/10 -> 37,5 | 50/50 -> 79,1 | 100/100 -> 96,3 | 100 câu đúng 90% -> 82,6
//               96% trên 50 câu (73,7) xếp trên 80% trên 100 câu (71,1): đúng cao được ưu tiên,
//               nhưng làm 12 câu hoàn hảo (42,1) không thể vượt người làm 100 câu đúng 80%.
//  - Cần làm ít nhất MIN_RANKED câu để vào bảng xếp hạng.

const { dayKey, VN_OFFSET } = require("./questionStats");

const MIN_RANKED = 10;          // số câu tối thiểu để vào bảng xếp hạng
const MIN_ACCURACY_BOARD = 20;  // bảng "Chính xác" cần nhiều câu hơn để tránh may mắn
const FULL_VOLUME = 100;        // làm đủ ngần này câu thì hệ số chăm chỉ đạt tối đa
const DAY_MS = 86400000;

// Cận dưới khoảng tin cậy Wilson (z = 1.96 ~ 95%). Trả về giá trị trong [0, 1].
function wilsonLower(correct, n, z = 1.96) {
  if (!n) return 0;
  const p = correct / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, Math.min(1, (center - margin) / denom));
}

const round1 = (x) => Math.round(x * 10) / 10;

// Hệ số chăm chỉ trong (0, 1]: tăng nhanh lúc đầu rồi chậm dần (theo logarit), đạt 1 khi n >= FULL_VOLUME
function volumeFactor(n) {
  if (!n || n < 0) return 0;
  return Math.min(1, Math.log(1 + n) / Math.log(1 + FULL_VOLUME));
}

// Điểm xếp hạng (0 - 100, làm tròn 1 chữ số thập phân)
function scoreOf(correct, n) {
  return round1(wilsonLower(correct, n) * 100 * volumeFactor(n));
}

// Mốc bắt đầu của kỳ xếp hạng theo giờ Việt Nam (UTC+7). Trả về ms (UTC) hoặc null nếu "tất cả".
function periodStart(period, now = Date.now()) {
  if (period === "all") return null;
  const vn = new Date(now + VN_OFFSET); // các trường UTC của vn chính là giờ Việt Nam
  const y = vn.getUTCFullYear(), m = vn.getUTCMonth(), d = vn.getUTCDate();
  if (period === "month") return Date.UTC(y, m, 1) - VN_OFFSET;
  const dow = (vn.getUTCDay() + 6) % 7; // thứ Hai = 0
  return Date.UTC(y, m, d - dow) - VN_OFFSET;
}

// Lần làm đầu tiên của mỗi câu: Map<questionId, attempt>
function firstAttempts(attempts) {
  const sorted = [...attempts].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const first = new Map();
  for (const a of sorted) {
    const id = String(a.question);
    if (!first.has(id)) first.set(id, a);
  }
  return first;
}

/**
 * Thống kê từng học sinh.
 * @param attempts  [{ username, question, subject, isCorrect, createdAt }]
 * @param students  Map<username, { school, class }> (chỉ những người này được xếp hạng)
 * @returns         mảng { username, school, class, answered, correct, accuracy, score, lastAt }
 */
function computeStats(attempts, students) {
  const byUser = new Map();
  for (const a of attempts) {
    if (!students.has(a.username)) continue;
    if (!byUser.has(a.username)) byUser.set(a.username, []);
    byUser.get(a.username).push(a);
  }
  const out = [];
  for (const [username, list] of byUser) {
    const first = firstAttempts(list);
    let correct = 0, lastAt = 0;
    for (const a of first.values()) {
      if (a.isCorrect) correct++;
      const t = new Date(a.createdAt).getTime();
      if (t > lastAt) lastAt = t;
    }
    const answered = first.size;
    const info = students.get(username) || {};
    out.push({
      username,
      school: info.school || "",
      class: info.class || "",
      answered,
      correct,
      accuracy: answered ? round1((correct * 100) / answered) : 0,
      score: scoreOf(correct, answered),
      lastAt
    });
  }
  return out;
}

/**
 * Xếp hạng. sort: "score" (tổng hợp) | "accuracy" (chính xác) | "answered" (chăm chỉ).
 * Hòa thì xét lần lượt: số câu đúng, người đạt được sớm hơn, rồi tên.
 */
function rankBoard(stats, sort = "score") {
  const min = sort === "accuracy" ? MIN_ACCURACY_BOARD : MIN_RANKED;
  const eligible = stats.filter((s) => s.answered >= min);
  const primary = {
    score: (a, b) => b.score - a.score || b.answered - a.answered,
    accuracy: (a, b) => b.accuracy - a.accuracy || b.answered - a.answered,
    answered: (a, b) => b.answered - a.answered || b.accuracy - a.accuracy
  }[sort] || ((a, b) => b.score - a.score);
  eligible.sort((a, b) =>
    primary(a, b) ||
    b.correct - a.correct ||
    a.lastAt - b.lastAt ||
    (a.username < b.username ? -1 : a.username > b.username ? 1 : 0)
  );
  return eligible.map((s, i) => ({ ...s, rank: i + 1 }));
}

// ---------------------------------------------------------------------------
// HỒ SƠ
// ---------------------------------------------------------------------------

const SUBJECT_MIN_FOR_STRONGEST = 5;

// Số ngày liên tiếp có luyện tập. Vẫn còn "sống" nếu hôm nay chưa luyện nhưng hôm qua có luyện.
function streaks(dayKeys, now) {
  const set = new Set(dayKeys);
  let current = 0;
  let cursor = now;
  if (!set.has(dayKey(cursor))) cursor -= DAY_MS;
  while (set.has(dayKey(cursor))) { current++; cursor -= DAY_MS; }

  const sorted = [...set].sort();
  let longest = 0, run = 0, prev = null;
  for (const k of sorted) {
    const t = Date.parse(k + "T00:00:00Z");
    run = prev !== null && t - prev === DAY_MS ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = t;
  }
  return { current, longest };
}

function buildProfileStats(attempts, now = Date.now()) {
  const first = firstAttempts(attempts);
  let correct = 0;
  const subj = new Map();
  for (const a of first.values()) {
    if (a.isCorrect) correct++;
    const k = a.subject || "Khác";
    const g = subj.get(k) || { subject: k, answered: 0, correct: 0 };
    g.answered++;
    if (a.isCorrect) g.correct++;
    subj.set(k, g);
  }
  const answered = first.size;
  const subjects = [...subj.values()]
    .map((g) => ({ ...g, accuracy: round1((g.correct * 100) / g.answered) }))
    .sort((x, y) => y.answered - x.answered || y.accuracy - x.accuracy);

  const strongest = subjects
    .filter((g) => g.answered >= SUBJECT_MIN_FOR_STRONGEST)
    .sort((x, y) => y.accuracy - x.accuracy || y.answered - x.answered)[0] || null;

  // Hoạt động 14 ngày gần nhất (tính mọi lượt làm, kể cả làm lại)
  const activity = [];
  for (let i = 13; i >= 0; i--) {
    const ms = now - i * DAY_MS;
    const d = new Date(ms + VN_OFFSET);
    activity.push({
      date: dayKey(ms),
      label: `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      count: 0
    });
  }
  const idx = new Map(activity.map((d, i) => [d.date, i]));
  const dayKeys = [];
  let firstSeen = null, lastActive = null;
  for (const a of attempts) {
    const t = new Date(a.createdAt).getTime();
    const k = dayKey(t);
    dayKeys.push(k);
    if (idx.has(k)) activity[idx.get(k)].count++;
    if (firstSeen === null || t < firstSeen) firstSeen = t;
    if (lastActive === null || t > lastActive) lastActive = t;
  }

  return {
    answered,
    correct,
    accuracy: answered ? round1((correct * 100) / answered) : 0,
    score: scoreOf(correct, answered),
    subjects,
    strongest,
    activity,
    streak: streaks(dayKeys, now),
    firstSeen: firstSeen ? new Date(firstSeen).toISOString() : null,
    lastActive: lastActive ? new Date(lastActive).toISOString() : null
  };
}

const PERIOD_TEXT = { week: "tuần này", month: "tháng này", all: "mọi thời điểm" };
const MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };

/**
 * Huy hiệu. ranks: { week, month, all } mỗi mục là { rank, total } hoặc null.
 * Trả về cả huy hiệu chưa đạt (earned=false) kèm tiến độ để học sinh có mục tiêu.
 */
function buildBadges(p, ranks) {
  const badges = [];

  for (const period of ["week", "month", "all"]) {
    const r = ranks && ranks[period];
    if (r && r.rank <= 3) {
      badges.push({
        id: `top-${period}`,
        icon: MEDAL[r.rank],
        title: `Top ${r.rank} ${PERIOD_TEXT[period]}`,
        desc: `Đứng hạng ${r.rank}/${r.total} trên bảng xếp hạng ${PERIOD_TEXT[period]}.`,
        earned: true
      });
    }
  }

  const vol = [[500, "🏔️", "Cao thủ luyện đề"], [200, "📚", "Chăm chỉ"], [50, "🌱", "Khởi động"]];
  const volHit = vol.find(([n]) => p.answered >= n);
  if (volHit) {
    badges.push({ id: "volume", icon: volHit[1], title: volHit[2], desc: `Đã làm ${p.answered} câu hỏi khác nhau.`, earned: true });
  } else {
    badges.push({ id: "volume", icon: "🌱", title: "Khởi động", desc: "Làm 50 câu hỏi khác nhau.", earned: false, progress: { value: p.answered, target: 50 } });
  }

  if (p.answered >= 30 && p.accuracy >= 90) {
    badges.push({ id: "accuracy", icon: "🎯", title: "Chính xác", desc: `Đúng ${p.accuracy}% trên ${p.answered} câu.`, earned: true });
  } else {
    badges.push({ id: "accuracy", icon: "🎯", title: "Chính xác", desc: "Đúng từ 90% trở lên với ít nhất 30 câu.", earned: false, progress: { value: Math.min(p.answered, 30), target: 30 } });
  }

  const deep = p.subjects.filter((g) => g.answered >= 10 && g.accuracy >= 70).length;
  if (deep >= 3) {
    badges.push({ id: "versatile", icon: "🧠", title: "Học đều nhiều môn", desc: `Đúng từ 70% ở ${deep} môn (mỗi môn từ 10 câu).`, earned: true });
  } else {
    badges.push({ id: "versatile", icon: "🧠", title: "Học đều nhiều môn", desc: "Đúng từ 70% ở 3 môn khác nhau (mỗi môn từ 10 câu).", earned: false, progress: { value: deep, target: 3 } });
  }

  return badges;
}

module.exports = {
  wilsonLower, volumeFactor, scoreOf, periodStart, firstAttempts, computeStats, rankBoard,
  buildProfileStats, buildBadges, streaks,
  MIN_RANKED, MIN_ACCURACY_BOARD, FULL_VOLUME
};
