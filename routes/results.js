const express = require('express');
const router  = express.Router();
const Result  = require('../models/Result');

/* 3. NỘP BÀI */
router.post('/submit', async (req, res) => {
  try {
    const { examId, userId, answers } = req.body;

    // hàm tính điểm tự động (viết ở dưới hoặc import)
    const autoScore = calcAutoScore(answers);

    const result = await Result.findOneAndUpdate(
      { examId, userId },
      {
        $set: {
          answers,
          autoScore,
          status: 'graded'
        }
      },
      { upsert: true, new: true }
    );

    res.json({ result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* 4. XEM ĐIỂM */
router.get('/exams/:id/results', async (req, res) => {
  try {
    const list = await Result
      .find({ examId: req.params.id })
      .select('userId autoScore startedAt createdAt answers score')
      .lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ------------ helpers ------------ */
function calcAutoScore(answers) {
  // ví dụ đơn giản: đếm câu đúng / tổng câu
  if (!answers || !answers.length) return 0;
  const correct = answers.filter(a => a.isCorrect).length;
  return (correct / answers.length * 10).toFixed(2); // thang 10
}

module.exports = router;