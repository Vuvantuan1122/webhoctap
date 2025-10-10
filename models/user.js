const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email:    { type: String, required: true },
  password: { type: String, required: true },
  role:     { type: String, required: true },
  school:   { type: String },
  class:    { type: String },
  loginHistory: [
    { ip: String, time: { type: Date, default: Date.now } }
  ],

  // ✅ Thêm 3 trường mới
  isVerified: { type: Boolean, default: false },
  verificationCode: String,
  verificationExpires: Date
});

module.exports = mongoose.model('User', userSchema);
