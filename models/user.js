const mongoose = require('mongoose');

// Định nghĩa schema người dùng
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email:    { type: String, required: true },
  password: { type: String, required: true },
  role:     { type: String, required: true }, // "student" hoặc "teacher"
  school:   { type: String },
  class:    { type: String }
});

// Export model tên là 'User' dựa trên schema trên
module.exports = mongoose.model('User', userSchema);
