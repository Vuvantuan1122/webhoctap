const mongoose = require("mongoose");

const CommentSchema = new mongoose.Schema({
  postId: String,
  author: String,
  content: String,
  imageUrl: String, // ✅ thêm trường ảnh
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Comment", CommentSchema);
