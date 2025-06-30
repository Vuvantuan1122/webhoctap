const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const User = require('./models/User');

const users = JSON.parse(fs.readFileSync(path.join(__dirname, 'users.json')));

// Kết nối MongoDB Atlas
mongoose.connect('mongodb+srv://Vuvantuan1122:<Tuan2009>@webhoctap.x8detll.mongodb.net/webhoctap?retryWrites=true&w=majority&appName=webhoctap', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
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