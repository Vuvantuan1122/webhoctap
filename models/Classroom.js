// models/Classroom.js
const mongoose = require('mongoose');

const classroomSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  teacherUsername: { type: String, required: true },
  joinCode: { type: String, required: true, unique: true },
  students: [{ type: String }],  // ✅ THAY ĐỔI: [String] thay vì [ObjectId]
  pendingStudents: [{ type: String }],  // ✅ THAY ĐỔI: [String] thay vì [ObjectId]
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Classroom', classroomSchema);