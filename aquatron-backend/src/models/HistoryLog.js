const mongoose = require('mongoose');

const testLogSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: false,
    default: 'default'
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  userId: {
    type: String,
    required: false
  },
  action: {
    type: String,
    required: true
  },
  command: {
    type: String
  },
  parameters: {
    type: Object,
    required: true
  },
  elements: [{
    symbol: String,
    name: String,
    quantity: Number,
    vout_base: Number,
    freq: Number
  }],
  settings: {
    type: Object
  },
  transportMode: {
    type: String,
    enum: ['wifi', 'uart', 'tcp', 'auto'],
    default: 'auto'
  },
  deviceResponse: {
    success: Boolean,
    message: String,
    timestamp: Date
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  // Additional fields for better tracking
  elementCount: {
    type: Number,
    default: 0
  },
  totalQuantity: {
    type: Number,
    default: 0
  },
  debug: {
    type: Boolean,
    default: false
  }
});

// Add indexes for better query performance
testLogSchema.index({ deviceId: 1, timestamp: -1 });
testLogSchema.index({ user: 1, timestamp: -1 });
testLogSchema.index({ action: 1, timestamp: -1 });
testLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model('TestLog', testLogSchema);
