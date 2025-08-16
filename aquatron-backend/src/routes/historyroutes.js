const express = require('express');
const router = express.Router();
const TestLog = require('../models/HistoryLog');
const { authenticate } = require('../middleware/auth');

// GET /api/history/user
router.get('/user', authenticate, async (req, res) => {
  try {
    console.log('🔍 GET /api/history/user called by user:', req.user.id);
    
    const userId = req.user.id || req.user._id || req.user.userId;
    if (!userId) {
      console.log('❌ User ID missing from token:', req.user);
      return res.status(400).json({ message: 'User ID missing from token' });
    }

    // Parse query parameters for filtering
    const { action, transport, startDate, endDate, limit = 100 } = req.query;
    
    // Build filter object
    let filter = { user: userId };
    
    if (action) {
      filter.action = { $regex: action, $options: 'i' };
    }
    
    if (transport) {
      filter.transportMode = transport;
    }
    
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate);
      if (endDate) filter.timestamp.$lte = new Date(endDate);
    }

    console.log('🔍 User history filter applied:', filter);

    // Fetch logs with enhanced population and sorting
    const logs = await TestLog.find(filter)
      .populate('user', 'username email role')
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    console.log('🔍 User logs found count:', logs.length);
    console.log('🔍 User first log sample:', logs[0]);

    res.json(logs);
  } catch (err) {
    console.error('❌ Error in /api/history/user:', err);
    res.status(500).json({ message: 'Failed to fetch history logs' });
  }
});

// GET /api/history/all - for admin users
router.get('/all', authenticate, async (req, res) => {
  try {
    console.log('🔍 GET /api/history/all called by user:', req.user.role);
    
    // Check if user has admin privileges
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      console.log('❌ Access denied for user role:', req.user.role);
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    // Parse query parameters for filtering
    const { action, transport, startDate, endDate, userId, limit = 200 } = req.query;
    
    // Build filter object
    let filter = {};
    
    if (action) {
      filter.action = { $regex: action, $options: 'i' };
    }
    
    if (transport) {
      filter.transportMode = transport;
    }
    
    if (userId) {
      filter.user = userId;
    }
    
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate);
      if (endDate) filter.timestamp.$lte = new Date(endDate);
    }

    console.log('🔍 Filter applied:', filter);

    // Fetch all logs with enhanced population and sorting
    const logs = await TestLog.find(filter)
      .populate('user', 'username email role')
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    console.log('🔍 Found logs count:', logs.length);
    console.log('🔍 First log sample:', logs[0]);

    res.json(logs);
  } catch (err) {
    console.error('❌ Error in /api/history/all:', err);
    res.status(500).json({ message: 'Failed to fetch all history logs' });
  }
});

// GET /api/history/user/:userId - for specific user logs (admin only)
router.get('/user/:userId', authenticate, async (req, res) => {
  try {
    // Check if user has admin privileges or is requesting their own logs
    const requestedUserId = req.params.userId;
    const currentUserId = req.user.id || req.user._id || req.user.userId;
    
    if (!['admin', 'superadmin'].includes(req.user.role) && requestedUserId !== currentUserId) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    // Parse query parameters for filtering
    const { action, transport, startDate, endDate, limit = 100 } = req.query;
    
    // Build filter object
    let filter = { user: requestedUserId };
    
    if (action) {
      filter.action = { $regex: action, $options: 'i' };
    }
    
    if (transport) {
      filter.transportMode = transport;
    }
    
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate);
      if (endDate) filter.timestamp.$lte = new Date(endDate);
    }

    // Fetch logs for the specific user
    const logs = await TestLog.find(filter)
      .populate('user', 'username email role')
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch user history logs' });
  }
});

// GET /api/history/stats - for admin users to get statistics
router.get('/stats', authenticate, async (req, res) => {
  try {
    // Check if user has admin privileges
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    const { startDate, endDate } = req.query;
    
    // Build date filter
    let dateFilter = {};
    if (startDate || endDate) {
      dateFilter.timestamp = {};
      if (startDate) dateFilter.timestamp.$gte = new Date(startDate);
      if (endDate) dateFilter.timestamp.$lte = new Date(endDate);
    }

    // Get statistics
    const stats = await TestLog.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalLogs: { $sum: 1 },
          totalUsers: { $addToSet: '$user' },
          actions: { $addToSet: '$action' },
          transportModes: { $addToSet: '$transportMode' },
          avgElementCount: { $avg: '$elementCount' },
          avgTotalQuantity: { $avg: '$totalQuantity' }
        }
      },
      {
        $project: {
          _id: 0,
          totalLogs: 1,
          uniqueUsers: { $size: '$totalUsers' },
          actions: 1,
          transportModes: 1,
          avgElementCount: { $round: ['$avgElementCount', 2] },
          avgTotalQuantity: { $round: ['$avgTotalQuantity', 2] }
        }
      }
    ]);

    res.json(stats[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch history statistics' });
  }
});

module.exports = router;
