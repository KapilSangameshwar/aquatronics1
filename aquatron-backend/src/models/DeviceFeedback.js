const mongoose = require('mongoose');


const DeviceFeedbackSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  feedback: { type: Object, required: true },
  receivedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('DeviceFeedback', DeviceFeedbackSchema);
