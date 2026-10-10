// Nạp tài khoản từ users.json vào database.
//
//   node import-users.js            -> chỉ THÊM tài khoản chưa có (an toàn, không xóa gì)
//   node import-users.js --reset    -> XÓA TOÀN BỘ tài khoản hiện có rồi nạp lại (nguy hiểm)
//
// Chuỗi kết nối lấy từ MONGODB_URI trong file .env (không ghi mật khẩu vào mã nguồn).

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const User = require('./models/user');

const RESET = process.argv.includes('--reset');

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('❌ Không tìm thấy MONGODB_URI trong file .env');
    process.exit(1);
  }

  const users = JSON.parse(fs.readFileSync(path.join(__dirname, 'users.json'), 'utf8'));

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Đã kết nối MongoDB');

  if (RESET) {
    console.log('⚠️  --reset: đang xóa toàn bộ tài khoản hiện có...');
    await User.deleteMany({});
  }

  let added = 0;
  let skipped = 0;
  for (const u of users) {
    const existed = await User.findOne({ $or: [{ username: u.username }, { email: u.email }] });
    if (existed) { skipped++; continue; }
    // isVerified phải là true, nếu không tài khoản sẽ không đăng nhập được
    await User.create({ ...u, isVerified: true });
    added++;
  }

  console.log(`✅ Đã thêm ${added} tài khoản, bỏ qua ${skipped} tài khoản đã tồn tại.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Lỗi:', err.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
