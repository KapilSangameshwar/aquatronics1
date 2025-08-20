const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const {
  getDeviceStatus,
  sendDeviceCommand,
  getDeviceSettings,
  setDeviceSettings,
  sendSWParameters,
  requestDeviceReady,
  sendDebugPacket,
  getTransportMode,
  setTransportMode,
  getFeedbackInfo,
  getADCData,
  getStatistics
} = require('../controllers/deviceController');
const { getTransportStatus } = require('../services/deviceComm');
// Feedback/ADC/statistics endpoints
router.get('/feedback-info', authenticate, authorize(['superadmin', 'admin', 'user']), getFeedbackInfo);
router.get('/adc-data', authenticate, authorize(['superadmin', 'admin', 'user']), getADCData);
router.get('/statistics', authenticate, authorize(['superadmin', 'admin', 'user']), getStatistics);

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
router.post('/sw-parameters', authenticate, authorize(['superadmin', 'admin', 'user']), (req, res, next) => {
  console.log('🔍 ROUTE: /sw-parameters hit');
  console.log('🔍 Request body:', req.body);
  console.log('🔍 User:', req.user);
  console.log('🔍 Calling sendSWParameters controller...');
  sendSWParameters(req, res, next);
});

// Request device ready status
router.post('/ready', authenticate, authorize(['superadmin', 'admin', 'user']), requestDeviceReady);

// Debug panel - send custom packets (superadmin only)
router.post('/debug', authenticate, authorize(['superadmin']), sendDebugPacket);

// Transport status (ws/tcp/serial)
router.get('/transport-status', authenticate, authorize(['superadmin', 'admin', 'user']), (req, res) => {
  res.json(getTransportStatus());
});

// Transport mode (auto | wifi | uart | tcp)
router.get('/transport-mode', authenticate, authorize(['superadmin', 'admin', 'user']), getTransportMode);
router.post('/transport-mode', authenticate, authorize(['superadmin', 'admin']), setTransportMode);

module.exports = router;
