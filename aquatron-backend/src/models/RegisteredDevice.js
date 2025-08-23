const mongoose = require('mongoose');

const RegisteredDeviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  customName: { type: String, required: true },
  latitude: { type: Number, required: false },
  longitude: { type: Number, required: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RegisteredDevice', RegisteredDeviceSchema);
