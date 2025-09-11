const mongoose = require("mongoose");

const PostSchema = new mongoose.Schema({
  author: String, // tên tài khoản
  caption: String, // chú thích
  imageUrl: String, // đường dẫn ảnh
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Post", PostSchema);
