const mongoose = require('mongoose');

const scoreSchema = new mongoose.Schema({
  p15_1: { type: Number, default: null },
  p15_2: { type: Number, default: null },
  p45_1: { type: Number, default: null },
  hki: { type: Number, default: null },
  hkii: { type: Number, default: null },
}, { _id: false });

const studentSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  username: { type: String, required: true },
  fullname: { type: String, default: 'Student Default' },
  class: { type: String, required: true },
  dob: { type: String, default: '01/01/2000' },
  scores: {
    type: Map,
    of: scoreSchema
  }
});

module.exports = mongoose.model('Student', studentSchema);