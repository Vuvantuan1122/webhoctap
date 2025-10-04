const mongoose = require("mongoose");

const exitLogSchema = new mongoose.Schema({
  examId: String,
  userId: String,
  reason: String,
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model("ExitLog", exitLogSchema);
