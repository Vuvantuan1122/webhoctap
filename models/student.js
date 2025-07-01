const mongoose = require('mongoose');

const scoreSchema = new mongoose.Schema({
  p15_1: Number,
  p15_2: Number,
  p45_1: Number,
  hki: Number,
  hkii: Number
}, { _id: false });

const studentSchema = new mongoose.Schema({
  username: String,
  fullname: String,
  class: String,
  dob: String,
  scores: { type: Map, of: scoreSchema }
});

module.exports = mongoose.model('Student', studentSchema);