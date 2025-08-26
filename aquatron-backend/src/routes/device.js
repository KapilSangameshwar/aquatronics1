const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { getRegisteredDevices, registerDevice } = require('../controllers/deviceController');
// Get all registered devices
router.get('/registered', getRegisteredDevices);
// Register a device (deviceId, customName)
router.post('/register', authenticate, authorize(['superadmin', 'admin']), registerDevice);
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
router.get('/feedback-info', getFeedbackInfo);
router.get('/adc-data', getADCData);
router.get('/statistics', getStatistics);

// Get device status (heartbeat/ready)
router.get('/status', getDeviceStatus);
// Send a raw command (cmd, elements, settings)
router.post('/command', authenticate, authorize(['superadmin', 'admin']), sendDeviceCommand);
// Get device settings
router.get('/settings', getDeviceSettings);
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
router.get('/transport-status', (req, res) => {
  res.json(getTransportStatus());
});

// Transport mode (auto | wifi | uart | tcp)
router.get('/transport-mode', getTransportMode);
router.post('/transport-mode', authenticate, authorize(['superadmin', 'admin']), setTransportMode);


// Registered device management
const registeredDeviceController = require('../controllers/registeredDeviceController');
router.get('/devices/registered', registeredDeviceController.getRegisteredDevices);
router.post('/devices/register', authenticate, authorize(['superadmin', 'admin']), registeredDeviceController.registerDevice);
router.put('/devices/register/:id', authenticate, authorize(['superadmin', 'admin']), registeredDeviceController.updateRegisteredDevice);
router.delete('/devices/register/:id', authenticate, authorize(['superadmin', 'admin']), registeredDeviceController.deleteRegisteredDevice);
router.get('/devices/online', registeredDeviceController.getOnlineDevices);

module.exports = router;
