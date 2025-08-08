const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { getUserLogs, getAllLogs } = require('../controllers/testLogController');

const router = express.Router();

// User gets their own logs
router.get('/my', authenticate, authorize(['user', 'admin', 'superadmin']), getUserLogs);

// Admins/superadmins can get all logs
router.get('/all', authenticate, authorize(['admin', 'superadmin']), getAllLogs);

module.exports = router;
