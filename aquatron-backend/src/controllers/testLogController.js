const TestLog = require('../models/Testlog');

exports.getUserLogs = async (req, res) => {
  try {
    const logs = await TestLog.find({ user: req.user.id }).sort({ timestamp: -1 });
    res.status(200).json(logs);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch logs', error: err.message });
  }
};

exports.getAllLogs = async (req, res) => {
  try {
    const logs = await TestLog.find().populate('user', 'username email').sort({ timestamp: -1 });
    res.status(200).json(logs);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch all logs', error: err.message });
  }
};
