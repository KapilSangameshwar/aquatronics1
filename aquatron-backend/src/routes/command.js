const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { getCommandHistory } = require('../controllers/commandController');
const router = express.Router();

router.get('/history', authenticate, authorize(['superadmin', 'admin']), getCommandHistory);

module.exports = router;
