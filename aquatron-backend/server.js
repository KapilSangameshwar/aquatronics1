// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');
const historyRoutes = require('./routes/historyRoutes');
const testRoutes = require('./routes/testRoutes');
const deviceRoutes = require('./src/routes/device'); // Add device routes
const { authenticate } = require('./middleware/auth');

// Connect to MongoDB
connectDB();

const app = express();

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`🔍 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  console.log(`🔍 Headers:`, req.headers);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`🔍 Body:`, req.body);
  }
  next();
});

// Routes
app.get('/', (req, res) => {
  res.send('✅ Backend API is running');
});

// Protected routes
app.use('/api/history', authenticate, historyRoutes);
app.use('/api/tests', authenticate, testRoutes);
app.use('/api/device', authenticate, deviceRoutes); // Add device routes

// Debug endpoint to check TestLog collection
app.get('/api/debug/testlogs', authenticate, async (req, res) => {
  try {
    const TestLog = require('./src/models/HistoryLog');
    const count = await TestLog.countDocuments();
    const latest = await TestLog.find().sort({ timestamp: -1 }).limit(5);
    
    res.json({
      totalCount: count,
      latestLogs: latest,
      message: 'Debug info for TestLog collection'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handler middleware
app.use((err, req, res, next) => {
  console.error(`❌ Error: ${err.message}`);
  res.status(err.statusCode || 500).json({
    message: err.message || 'Server Error'
  });
});

// Socket.IO setup
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true
  }
});

// Attach io to app for controller access
app.set('io', io);

// Pass io to deviceComm setup
const { setupSerial, setupTCP, setupWS } = require('./src/services/deviceComm');
setupSerial(io);
setupTCP(io);
setupWS(io);

// Socket.io connection logging
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  // Log all incoming events
  socket.onAny((eventName, ...args) => {
    console.log(`🔌 Socket.IO Event: ${eventName}`, args);
  });
  socket.on('disconnect', () => console.log('🔌 Client disconnected:', socket.id));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  console.log(`🔍 Debug logging enabled - all requests will be logged`);
});
