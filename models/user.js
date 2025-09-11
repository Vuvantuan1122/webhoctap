const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email:    { type: String, required: true },
  password: { type: String, required: true },
  role:     { type: String, required: true }, // "student" hoặc "teacher"
  school:   { type: String },
  class:    { type: String },

  // 📌 Lưu lịch sử IP đăng nhập
  loginHistory: [
    {
      ip: String,
      time: { type: Date, default: Date.now }
    }
  ]
});

module.exports = mongoose.model('User', userSchema);
