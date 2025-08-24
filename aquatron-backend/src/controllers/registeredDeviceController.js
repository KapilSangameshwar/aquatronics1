const RegisteredDevice = require('../models/RegisteredDevice');

// Get all registered devices
exports.getRegisteredDevices = async (req, res) => {
  const devices = await RegisteredDevice.find();
  res.json(devices);
};

// Register a new device
exports.registerDevice = async (req, res) => {
  const { deviceId, customName, latitude, longitude } = req.body;
  if (!deviceId || !customName) return res.status(400).json({ message: 'Device ID and custom name required.' });
  try {
    const device = new RegisteredDevice({ deviceId, customName, latitude, longitude });
    await device.save();
    res.status(201).json(device);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Device already registered.' });
    res.status(500).json({ message: 'Error registering device.' });
  }
};

// Update a device's custom name
exports.updateRegisteredDevice = async (req, res) => {
  const { id } = req.params;
  const { customName } = req.body;
  if (!customName) return res.status(400).json({ message: 'Custom name required.' });
  const device = await RegisteredDevice.findByIdAndUpdate(id, { customName }, { new: true });
  if (!device) return res.status(404).json({ message: 'Device not found.' });
  res.json(device);
};

// Delete a registered device
exports.deleteRegisteredDevice = async (req, res) => {
  const { id } = req.params;
  const device = await RegisteredDevice.findByIdAndDelete(id);
  if (!device) return res.status(404).json({ message: 'Device not found.' });
  res.json({ message: 'Device deleted.' });
};

// Placeholder: Get online devices (should be replaced with real logic)
exports.getOnlineDevices = async (req, res) => {
  // Return deviceIds from recent heartbeats (last 2 minutes)
  const since = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago
  const TestLog = require('../models/HistoryLog');
  const heartbeats = await TestLog.aggregate([
    { $match: { action: 'Device Heartbeat', deviceId: { $exists: true, $ne: null }, timestamp: { $gte: since } } },
    { $group: { _id: '$deviceId' } }
  ]);
  const onlineDeviceIds = heartbeats.map(hb => hb._id);
  res.json(onlineDeviceIds);
};
