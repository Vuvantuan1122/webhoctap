const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const User = require('./models/user');

const users = JSON.parse(fs.readFileSync(path.join(__dirname, 'users.json')));

// Kết nối MongoDB Atlas
mongoose.connect('mongodb+srv://tuantento2009:tuan2009@webhoctap.ts6ia7t.mongodb.net/?retryWrites=true&w=majority&appName=webhoctap').then(async () => {
  console.log('✅ Đã kết nối MongoDB');

  // Xoá toàn bộ dữ liệu cũ nếu cần
  await User.deleteMany({});

  // Chèn dữ liệu từ file
  await User.insertMany(users);
  console.log('✅ Đã import dữ liệu người dùng từ users.json');

  mongoose.disconnect();
}).catch(err => {
  console.error('❌ Lỗi kết nối MongoDB:', err);
});