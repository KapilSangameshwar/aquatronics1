const {
  sendCommandToSTM32,
  getDeviceStatusFromSTM32,
  requestDeviceReady,
  buildPacket,
  sendPacket,
  CMD_GET_DEVICE_READY,
  CMD_SEND_SW_PARAMETERS,
  CMD_SET_DEVICE_SETTINGS,
  CMD_GET_DEVICE_SETTINGS,
  setTransportMode,
  getTransportMode,
  CMD_GET_FEEDBACK_INFO,
  CMD_FEEDBACK_INFO,
  CMD_GET_ADC,
  CMD_ADC_DATA,
  CMD_GET_STAT,
  CMD_STAT_DATA
} = require('../services/deviceComm');
// --- FEEDBACK/ADC/STATISTICS CONTROLLERS ---

exports.getFeedbackInfo = async (req, res, next) => {
  try {
    const preferredTransport = req.query.transport || req.headers['x-transport'] || req.body.transport;
    // Wait for feedback-info event from STM32
    const result = await getFeedbackInfoFromSTM32(preferredTransport);
    // Emit feedback-info event to the requesting user's socket using x-socket-id header
    const io = req.app && req.app.get('io');
    const socketId = req.headers['x-socket-id'];
    if (io && socketId) {
      io.to(socketId).emit('feedback-info', result);
    } else if (io) {
      io.emit('feedback-info', result);
    }
    res.json(result);
  } catch (err) { next(err); }
};

exports.getADCData = async (req, res, next) => {
  try {
    const preferredTransport = req.query.transport || req.headers['x-transport'] || req.body.transport;
    // No payload needed for ADC data request
    const result = await sendCommandToSTM32(CMD_GET_ADC, undefined, preferredTransport);
    res.json(result);
  } catch (err) { next(err); }
};

exports.getStatistics = async (req, res, next) => {
  try {
    const preferredTransport = req.query.transport || req.headers['x-transport'] || req.body.transport;
    // No payload needed for statistics request
    const result = await sendCommandToSTM32(CMD_GET_STAT, undefined, preferredTransport);
    res.json(result);
  } catch (err) { next(err); }
};

const TestLog = require('../models/HistoryLog'); // ✅ New import
const mongoose = require('mongoose');

// Helper to convert hex string to Buffer
function hexToBuffer(hex) {
  if (!hex) return Buffer.alloc(0);
  return Buffer.from(hex, 'hex');
}

exports.getDeviceStatus = async (req, res, next) => {
  try {
    const preferredTransport = req.query.transport || req.headers['x-transport'];
    const status = await getDeviceStatusFromSTM32(preferredTransport);
    res.json(status);
  } catch (err) { next(err); }
};

// Static lookup table for vout_base and freq
const ELEMENT_PROFILES = {
  Li: { vout_base: 3.71, freq: 2226 },
  Ca: { vout_base: 2.95, freq: 1765 },
  Na: { vout_base: 3.032, freq: 1818 },
  Cl: { vout_base: 3.916, freq: 2351 },
  Fe: { vout_base: 4.558, freq: 2739 },
  Zn: { vout_base: 4.167, freq: 2504 },
  Cu: { vout_base: 4.557, freq: 2739 },
  Pb: { vout_base: 3.321, freq: 1988 },
  Mg: { vout_base: 3.63, freq: 2175 },
  Mn: { vout_base: 4.497, freq: 2697 },
  Cd: { vout_base: 3.711, freq: 2228 },
  K:  { vout_base: 2.454, freq: 1466 },
  B:  { vout_base: 5.256, freq: 3161 },
  F:  { vout_base: 3.896, freq: 2340 },
  Mo: { vout_base: 4.147, freq: 2486 },
  Ni: { vout_base: 4.661, freq: 2797 },
  Se: { vout_base: 3.423, freq: 2052 },
  Si: { vout_base: 3.814, freq: 2287 },
  Ag: { vout_base: 4.043, freq: 2428 },
  As: { vout_base: 3.711, freq: 2228 },
  Hg: { vout_base: 3.568, freq: 2140 },
  P:  { vout_base: 3.402, freq: 2041 },
  Al: { vout_base: 4.065, freq: 2439 },
  Cr: { vout_base: 1.343, freq: 797 },
  Co: { vout_base: 4.66, freq: 2797 },
  Ba: { vout_base: 2.598, freq: 1554 },
  Am: { vout_base: 3.341, freq: 1999 },
  NO: { vout_base: 4.660, freq: 2797 }
};

// Helper: build payload for CMD_SEND_SW_PARAMETERS (now includes vout_base and freq)
function buildSWParametersPayload(elements) {
  if (!Array.isArray(elements) || elements.length < 1 || elements.length > 30) {
    throw new Error('Invalid elements array (must be 1-30)');
  }
  // Each element: 2 bytes symbol, 2 bytes quantity (total 4 bytes per element)
  const payload = Buffer.alloc(1 + elements.length * 4);
  payload[0] = elements.length;
  elements.forEach((el, i) => {
    const symbol = el.symbol || '';
    const base = 1 + i * 4;
    payload[base] = symbol.charCodeAt(0) || 0;
    payload[base + 1] = symbol.charCodeAt(1) || 0;
    payload.writeUInt16LE(el.quantity || 0, base + 2);
  });
  return payload;
}

// Helper: build payload for CMD_SET_DEVICE_SETTINGS
function buildDeviceSettingsPayload({ freefall, hptf, harmonic, duration_ms, vout_table }) {
  const count = vout_table ? vout_table.length : 0;
  const payload = Buffer.alloc(8 + count * 11);
  payload.writeInt16LE(freefall, 0);
  payload.writeInt16LE(hptf, 2);
  payload[4] = harmonic; // 0=FULL, 1=HALF, 2=QUARTER
  payload.writeUInt16LE(duration_ms, 5);
  payload[7] = count;
  for (let i = 0; i < count; i++) {
    const base = 8 + i * 11;
    payload[base] = vout_table[i].symbol.charCodeAt(0);
    payload[base + 1] = vout_table[i].symbol.charCodeAt(1);
    payload[base + 2] = vout_table[i].symbol.charCodeAt(2) || 0;
    payload.writeFloatLE(vout_table[i].vout_base, base + 3);
    payload.writeUInt32LE(vout_table[i].freq, base + 7);
  }
  return payload;
}

exports.sendDeviceCommand = async (req, res, next) => {
  try {
    const { cmd, elements, settings, transport } = req.body;
    let payload = Buffer.alloc(0);

    // 🎯 Build payload for the actual command
    if (cmd === CMD_SEND_SW_PARAMETERS) {
      payload = buildSWParametersPayload(elements);
    } else if (cmd === CMD_SET_DEVICE_SETTINGS) {
      payload = buildDeviceSettingsPayload(settings);
    }

    // Debug: Log command and transport
    console.log('[DeviceController] Sending command:', cmd, 'Transport:', transport);
    if (cmd === CMD_SEND_SW_PARAMETERS) {
      console.log('[DeviceController] STP payload:', payload.toString('hex'));
    }

    // ✅ For both SW_PARAMS and SETTINGS, send CMD_GET_DEVICE_READY first, then the command
    let result;
    if (cmd === CMD_SEND_SW_PARAMETERS || cmd === CMD_SET_DEVICE_SETTINGS) {
      // First send CMD_GET_DEVICE_READY to prompt microcontroller
      const readyPacket = buildPacket(CMD_GET_DEVICE_READY);
      sendPacket(readyPacket);
      console.log('[DeviceController] Sent CMD_GET_DEVICE_READY');
      // Wait a moment for the microcontroller to process the ready request
      await new Promise(resolve => setTimeout(resolve, 500));
      // Then send the actual command
      result = await sendCommandToSTM32(cmd, payload, transport);
      console.log('[DeviceController] Sent command result:', result);
    } else {
      // For other commands, send directly
      result = await sendCommandToSTM32(cmd, payload, transport);
      console.log('[DeviceController] Sent command result:', result);
    }

    // ✅ Save log to DB if user is logged in
    if (req.user && req.user.id) {
      const action = cmd === CMD_SEND_SW_PARAMETERS ? 'Send SW Parameters' : 
               cmd === CMD_SET_DEVICE_SETTINGS ? 'Set Device Settings' : 
               'Device Command';
      let deviceId = result && result.deviceId;
      if (!deviceId) {
        // Try to get the latest heartbeat deviceId from TestLog
        const lastHeartbeat = await TestLog.findOne({ action: 'Device Heartbeat', deviceId: { $exists: true, $ne: null } })
          .sort({ timestamp: -1 })
          .select('deviceId');
        if (lastHeartbeat && lastHeartbeat.deviceId) {
          deviceId = lastHeartbeat.deviceId;
        }
      }
      await TestLog.create({
        deviceId,
        user: req.user.id,
        userId: req.user.id.toString(),
        action: action,
        command: cmd,
        parameters: { cmd, elements, settings },
        elements: elements || undefined,
        settings: settings || undefined
      });
    }

    // If command was successful and device is ready, the system is now ready for next input
    if (result.deviceReady) {
      console.log('Command completed successfully. Device ready for next input.');
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
};


// exports.sendDeviceCommand = async (req, res, next) => {
//   try {
//     const { cmd, elements, settings } = req.body;
//     let payload = Buffer.alloc(0);

//     if (cmd === CMD_SEND_SW_PARAMETERS) {
//       payload = buildSWParametersPayload(elements);
//     } else if (cmd === CMD_SET_DEVICE_SETTINGS) {
//       payload = buildDeviceSettingsPayload(settings);
//     }

//     const result = await sendCommandToSTM32(cmd, payload);

//     // ✅ Save test log (if user is logged in)
//     if (req.user && req.user._id) {
//       await TestLog.create({
//         user: req.user._id,
//         command: cmd,
//         elements: elements || undefined,
//         settings: settings || undefined
//       });
//     }

//     res.json(result);
//   } catch (err) {
//     next(err);
//   }
// };

exports.getDeviceSettings = async (req, res, next) => {
  try {
    const preferredTransport = req.query.transport || req.headers['x-transport'];
    const { getDeviceSettingsFromSTM32 } = require('../services/deviceComm');
    const result = await getDeviceSettingsFromSTM32(preferredTransport);
    res.json(result);
  } catch (err) { next(err); }
};

exports.setDeviceSettings = async (req, res, next) => {
  try {
    const payload = buildDeviceSettingsPayload(req.body);
    
    // Send CMD_GET_DEVICE_READY first, then the command
    const readyPacket = buildPacket(CMD_GET_DEVICE_READY);
    sendPacket(readyPacket);
    
    // Wait a moment for the microcontroller to process the ready request
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const preferredTransport = req.query.transport || req.headers['x-transport'] || req.body.transport;
    const result = await sendCommandToSTM32(CMD_SET_DEVICE_SETTINGS, payload, preferredTransport);
    
    // ✅ Enhanced logging for history system
    if (req.user && req.user.id) {
      // Get current transport mode
      const currentTransportMode = getTransportMode();
      
      let deviceId = result && result.deviceId;
      if (!deviceId) {
        const lastHeartbeat = await TestLog.findOne({ action: 'Device Heartbeat', deviceId: { $exists: true, $ne: null } })
          .sort({ timestamp: -1 })
          .select('deviceId');
        if (lastHeartbeat && lastHeartbeat.deviceId) {
          deviceId = lastHeartbeat.deviceId;
        }
      }
      await TestLog.create({
    deviceId,
        user: req.user.id,
        userId: req.user.id.toString(),
        action: 'Set Device Settings',
        command: CMD_SET_DEVICE_SETTINGS,
        parameters: {
          cmd: CMD_SET_DEVICE_SETTINGS,
          settings: req.body,
          transport: preferredTransport || currentTransportMode
        },
        settings: req.body,
        transportMode: preferredTransport || currentTransportMode,
        deviceResponse: {
          success: result.success !== false,
          message: result.message || 'Settings updated successfully',
          timestamp: new Date()
        }
      });
    }
    
    res.json(result);
  } catch (err) { next(err); }
};

exports.sendSWParameters = async (req, res, next) => {
  try {
    console.log('🔍 sendSWParameters called with:', req.body);
    console.log('🔍 User info:', req.user);
    
    const payload = buildSWParametersPayload(req.body.elements);
    
    // Send CMD_GET_DEVICE_READY first, then the command
    const readyPacket = buildPacket(CMD_GET_DEVICE_READY);
    sendPacket(readyPacket);
    
    // Wait a moment for the microcontroller to process the ready request
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const preferredTransport = req.query.transport || req.headers['x-transport'] || req.body.transport;
    const result = await sendCommandToSTM32(CMD_SEND_SW_PARAMETERS, payload, preferredTransport);
    
    console.log('🔍 Device command result:', result);
    
    // ✅ Enhanced logging for history system
    if (req.user && req.user.id) {
      console.log('🔍 User authenticated, creating log entry...');
      
      // Calculate additional metrics
      const elementCount = req.body.elements.length;
      const totalQuantity = req.body.elements.reduce((sum, el) => sum + (el.quantity || 0), 0);
      
      // Get current transport mode
      const currentTransportMode = getTransportMode();
      
      console.log('🔍 Creating TestLog with data:', {
        user: req.user.id,
        elementCount,
        totalQuantity,
        transportMode: preferredTransport || currentTransportMode
      });
      
      try {
        let deviceId = result && result.deviceId;
        if (!deviceId) {
          const lastHeartbeat = await TestLog.findOne({ action: 'Device Heartbeat', deviceId: { $exists: true, $ne: null } })
            .sort({ timestamp: -1 })
            .select('deviceId');
          if (lastHeartbeat && lastHeartbeat.deviceId) {
            deviceId = lastHeartbeat.deviceId;
          }
        }
        const logEntry = await TestLog.create({
            deviceId,
          user: req.user.id,
          userId: req.user.id.toString(),
          action: 'Send SW Parameters',
          command: CMD_SEND_SW_PARAMETERS,
          parameters: {
            cmd: CMD_SEND_SW_PARAMETERS,
            elements: req.body.elements,
            transport: preferredTransport || currentTransportMode
          },
          elements: req.body.elements.map(el => {
            const profile = ELEMENT_PROFILES[el.symbol] || { vout_base: 0, freq: 0 };
            return {
              symbol: el.symbol,
              name: el.name || el.symbol, // Use symbol as name if not provided
              quantity: el.quantity || 0,
              vout_base: profile.vout_base,
              freq: profile.freq
            };
          }),
          transportMode: preferredTransport || currentTransportMode,
          deviceResponse: {
            success: result.success !== false,
            message: result.message || 'Parameters sent successfully',
            timestamp: new Date()
          },
          elementCount: elementCount,
          totalQuantity: totalQuantity
        });
        
        console.log('✅ TestLog created successfully:', logEntry._id);
      } catch (logError) {
        console.error('❌ Error creating TestLog:', logError);
      }
    } else {
      console.log('❌ No user or user.id found:', req.user);
    }
    
    res.json(result);
  } catch (err) { 
    console.error('❌ Error in sendSWParameters:', err);
    next(err); 
  }
};

exports.requestDeviceReady = async (req, res, next) => {
  try {
    const preferredTransport = req.query.transport || req.headers['x-transport'] || req.body.transport;
    const result = await requestDeviceReady(preferredTransport);
    res.json(result);
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
};

exports.sendDebugPacket = async (req, res, next) => {
  try {
    const { cmd, payload, description, transport } = req.body;
    
    // Validate command
    if (!cmd || isNaN(cmd)) {
      return res.status(400).json({ error: 'Invalid command' });
    }

    // Convert payload from hex string to buffer
    let payloadBuffer = Buffer.alloc(0);
    if (payload) {
      try {
        payloadBuffer = Buffer.from(payload, 'hex');
      } catch (err) {
        return res.status(400).json({ error: 'Invalid payload format' });
      }
    }

    // Send the debug packet
    const result = await sendCommandToSTM32(cmd, payloadBuffer, transport);

    // Log the debug action
    if (req.user && req.user.id) {
      let deviceId = result && result.deviceId;
      if (!deviceId) {
        const lastHeartbeat = await TestLog.findOne({ action: 'Device Heartbeat', deviceId: { $exists: true, $ne: null } })
          .sort({ timestamp: -1 })
          .select('deviceId');
        if (lastHeartbeat && lastHeartbeat.deviceId) {
          deviceId = lastHeartbeat.deviceId;
        }
      }
      await TestLog.create({
  deviceId,
        user: req.user.id,
        userId: req.user.id.toString(),
        action: 'Debug Packet',
        command: cmd,
        parameters: { cmd, payload, description },
        debug: true
      });
    }

    res.json({
      success: true,
      message: 'Debug packet sent successfully',
      result,
      timestamp: new Date().toISOString()
    });
  } catch (err) { 
    next(err); 
  }
};

exports.getTransportMode = (req, res) => {
  res.json({ mode: getTransportMode() });
};

exports.setTransportMode = (req, res) => {
  try {
    const { mode } = req.body;
    const updated = setTransportMode(mode);
    res.json({ success: true, mode: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};
