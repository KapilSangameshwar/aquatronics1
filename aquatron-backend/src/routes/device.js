const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const {
  getDeviceStatus,
  sendDeviceCommand,
  getDeviceSettings,
  setDeviceSettings,
  sendSWParameters
} = require('../controllers/deviceController');
const router = express.Router();

// Get device status (heartbeat/ready)
router.get('/status', authenticate, authorize(['superadmin', 'admin', 'user']), getDeviceStatus);
// Send a raw command (cmd, elements, settings)
router.post('/command', authenticate, authorize(['superadmin', 'admin']), sendDeviceCommand);
// Get device settings
router.get('/settings', authenticate, authorize(['superadmin', 'admin']), getDeviceSettings);
// Set device settings
router.post('/settings', authenticate, authorize(['superadmin', 'admin']), (req, res, next) => {
  if (req.user?.username === 'testuser') {
    return res.status(403).json({ message: 'testuser is not allowed to modify settings.' });
  }
  // Continue to the original handler
  setDeviceSettings(req, res, next);
});

// Send software parameters (elements)
router.post('/sw-parameters', authenticate, authorize(['superadmin', 'admin', 'user']), sendSWParameters);

module.exports = router;
