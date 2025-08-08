const mongoose = require('mongoose');

const deviceLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  payload: { type: Object }, // raw parameters/settings
});
    
module.exports = mongoose.model('DeviceLog', deviceLogSchema);
