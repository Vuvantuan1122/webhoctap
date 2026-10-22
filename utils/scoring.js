// Cách chấm điểm theo quy định của Bộ Giáo dục & Đào tạo.
//
// Câu Đúng/Sai gồm 4 ý (a, b, c, d). Mỗi ý học sinh chọn Đúng hoặc Sai.
// Điểm của CẢ câu (tối đa 1 điểm):
//   đúng 1 ý  -> 0,1 điểm
//   đúng 2 ý  -> 0,25 điểm
//   đúng 3 ý  -> 0,5 điểm
//   đúng 4 ý  -> 1 điểm
//
// Quy ước dữ liệu của câu Đúng/Sai:
//   options       = nội dung 4 ý [a, b, c, d]
//   correctAnswer = mảng 4 số, 0 = Đúng, 1 = Sai (ví dụ [0, 1, 0, 0])
//   bài làm       = mảng 4 giá trị 0 / 1 / null (null = chưa chọn)
//
// Câu Đúng/Sai kiểu cũ (options ["Đúng","Sai"], correctAnswer là một số) vẫn được chấm như
// trước (đúng = 1 điểm, sai = 0) để không làm hỏng đề đã tạo.

const TF_STATEMENTS = 4;
const TF_POINTS = [0, 0.1, 0.25, 0.5, 1];

// Câu Đúng/Sai theo định dạng mới (4 ý)?
function isMultiTF(q) {
  return !!q && q.type === "truefalse" && Array.isArray(q.correctAnswer);
}

// Chuyển 0/1 (hoặc "0"/"1") thành số; giá trị khác -> null
function toBit(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return n === 0 || n === 1 ? n : null;
}

// Số ý đúng của một câu Đúng/Sai 4 ý
function countTfCorrect(correct, answer) {
  if (!Array.isArray(correct) || !Array.isArray(answer)) return 0;
  let n = 0;
  for (let i = 0; i < TF_STATEMENTS; i++) {
    const a = toBit(answer[i]);
    const c = toBit(correct[i]);
    if (a !== null && c !== null && a === c) n++;
  }
  return n;
}

// Điểm của một câu Đúng/Sai 4 ý theo số ý đúng
function tfPoints(correctCount) {
  return TF_POINTS[Math.max(0, Math.min(TF_STATEMENTS, correctCount))] || 0;
}

// Chấm một câu tự động (trắc nghiệm / đúng-sai). Trả về { points (0..1), correctCount, full }
function gradeAuto(q, answer) {
  if (isMultiTF(q)) {
    const n = countTfCorrect(q.correctAnswer, answer);
    return { points: tfPoints(n), correctCount: n, full: n === TF_STATEMENTS };
  }
  const ans = answer !== null && answer !== undefined && answer !== "" ? Number(answer) : NaN;
  const ok = !Number.isNaN(ans) && ans === Number(q.correctAnswer);
  return { points: ok ? 1 : 0, correctCount: ok ? 1 : 0, full: ok };
}

// Kiểm tra dữ liệu câu Đúng/Sai 4 ý. Trả về chuỗi lỗi hoặc null nếu hợp lệ.
function validateTfData(options, correctAnswer) {
  if (!Array.isArray(options) || options.length !== TF_STATEMENTS || options.some((o) => !String(o || "").trim())) {
    return "Câu Đúng/Sai phải có đủ 4 ý (a, b, c, d), không được để trống.";
  }
  if (!Array.isArray(correctAnswer) || correctAnswer.length !== TF_STATEMENTS || correctAnswer.some((v) => toBit(v) === null)) {
    return "Câu Đúng/Sai phải chọn Đúng hoặc Sai cho cả 4 ý.";
  }
  return null;
}

module.exports = {
  TF_STATEMENTS,
  TF_POINTS,
  isMultiTF,
  toBit,
  countTfCorrect,
  tfPoints,
  gradeAuto,
  validateTfData
};
