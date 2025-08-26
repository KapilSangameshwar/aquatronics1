require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const deviceRoutes = require('./routes/device');
const commandRoutes = require('./routes/command');
const testLogRoutes = require('./routes/testLogRoutes');
const historyRoutes = require('./routes/historyroutes');
const { setupSerial, setupWS } = require('./services/deviceComm');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Middleware
app.use(cors());
app.use(express.json());

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
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/device', deviceRoutes);
app.use('/api/commands', commandRoutes);
app.use('/api/testlogs', testLogRoutes);
app.use('/api/history', historyRoutes);

// Error handling
app.use(errorHandler);

// MongoDB connection
const dbName = process.env.MONGO_DB_NAME || 'aquatron';
const mongoUri = process.env.MONGO_URI || `mongodb://localhost:27017/${dbName}`;
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log(`MongoDB connected to database: ${dbName}`))
  .catch(err => console.error('MongoDB connection error:', err));

// Device communication setup
const serialPortPath = process.env.SERIAL_PORT;
let serialBaud = process.env.SERIAL_BAUD;
if (serialBaud) {
  serialBaud = parseInt(String(serialBaud).replace(/\D/g, ''), 10) || 115200;
} else {
  serialBaud = 115200;
}
if (serialPortPath) {
  setupSerial(io, serialPortPath, serialBaud);
} else {
  console.warn('SERIAL_PORT not defined in .env, skipping serial setup');
}

setupWS(io);

// Socket.io connection
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  
  // Log all incoming events
  socket.onAny((eventName, ...args) => {
    console.log(`🔌 Socket.IO Event: ${eventName}`, args);
  });
  
  socket.on('disconnect', () => console.log('🔌 Client disconnected:', socket.id));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));