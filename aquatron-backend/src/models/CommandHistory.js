const mongoose = require('mongoose');

const commandHistorySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  command: String,
  response: String,
  success: Boolean,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CommandHistory', commandHistorySchema);
