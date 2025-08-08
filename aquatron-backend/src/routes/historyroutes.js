// src/routes/historyroutes.js

const express = require('express');
const router = express.Router();
const HistoryLog = require('../models/HistoryLog');

// GET /api/history/user/:userId
router.get('/user/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const logs = await HistoryLog.find({
      user: userId,
      timestamp: { $gte: sevenDaysAgo }
    }).sort({ timestamp: -1 });

    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch history logs' });
  }
});

module.exports = router;
