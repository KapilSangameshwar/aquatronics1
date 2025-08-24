// Wait for CMD_FEEDBACK_INFO response and return parsed feedback info
function getFeedbackInfoFromSTM32(preferredTransport) {
  return new Promise(async (resolve, reject) => {
    try {
      // Attach event handler BEFORE sending the command
      function handler(data) {
        clearTimeout(timeout);
        if (ioRef) ioRef.off('feedback-info', handler);
        console.log('[FeedbackInfo] feedback-info event received:', data);
        resolve(data); // Return the full structured object
      }
      if (ioRef) {
        ioRef.on('feedback-info', handler);
        console.log('[FeedbackInfo] Event handler attached for feedback-info');
      }
      // Timeout for response
      const timeout = setTimeout(() => {
        if (ioRef) ioRef.off('feedback-info', handler);
        reject(new Error('Timeout waiting for feedback info from STM32'));
      }, 3000);
  // Send get device ready and feedback info requests as a single combined binary message
  const readyPacket = buildPacket(CMD_GET_DEVICE_READY);
  const feedbackPacket = Buffer.from([0xAA, 0x09, 0x00, 0xA3, 0x55]);
  const combined = Buffer.concat([readyPacket, feedbackPacket]);
  console.log(`[SEND] Combined DeviceReady+FeedbackInfoRequest: ${combined.toString('hex')} via ${preferredTransport || 'auto'}`);
  const result = sendPacket(combined, preferredTransport);
  console.log(`[SEND] Combined sent via ${result.via || 'unknown'}: ${result.sent ? 'OK' : 'FAIL'} (${result.error || ''})`);
    } catch (err) {
      reject(err);
    }
  });
}
// --- FEEDBACK INFO PACKET CONSTANTS ---
const FEEDBACK_INFO_CMD = 0x0A;
const FEEDBACK_INFO_PAYLOAD_LEN = 47;
const FEEDBACK_INFO_PACKET_LEN = 1 + 1 + 1 + FEEDBACK_INFO_PAYLOAD_LEN + 1 + 1; // header+cmd+len+payload+checksum+end

let uartFeedbackBuffer = Buffer.alloc(0);
let tcpBuffer = Buffer.alloc(0);
let udpBuffer = Buffer.alloc(0);

// --- SEND FEEDBACK INFO REQUEST ---
function sendFeedbackInfoRequest(preferredTransport) {
  // Send: AA 09 00 A3 55
  const FEEDBACK_INFO_REQUEST = Buffer.from([0xAA, 0x09, 0x00, 0xA3, 0x55]);
  console.log(`[SEND] FeedbackInfoRequest: ${FEEDBACK_INFO_REQUEST.toString('hex')} via ${preferredTransport || 'auto'}`);
  if (preferredTransport === 'serial' || !preferredTransport) {
    if (serialPort) {
      serialPort.write(FEEDBACK_INFO_REQUEST);
      console.log('[SEND] FeedbackInfoRequest sent via serial');
    }
  } else {
    // fallback to old sendPacket for other transports
    const result = sendPacket(FEEDBACK_INFO_REQUEST, preferredTransport);
    console.log(`[SEND] FeedbackInfoRequest sent via ${result.via || 'unknown'}: ${result.sent ? 'OK' : 'FAIL'} (${result.error || ''})`);
  }
}

// --- UART and WS Feedback Buffer Handlers (must be after serialPort/wsClient declarations) ---
function attachFeedbackBufferHandlers(port) {
  if (port) {
    console.log('[SERIAL][DEBUG] Attaching serialPort data event handler...');
    port.on('data', (data) => {
      console.log('[SERIAL][EVENT] serialPort.on("data") fired');
      console.log('[SERIAL][RAW]', data.toString('hex'), 'len:', data.length);
      uartFeedbackBuffer = Buffer.concat([uartFeedbackBuffer, data]);
      console.log('[SERIAL][BUFFER]', uartFeedbackBuffer.toString('hex'), 'len:', uartFeedbackBuffer.length);
      uartFeedbackBuffer = processFeedbackBuffer(uartFeedbackBuffer, (payload) => {
        console.log('[SERIAL][PARSED PAYLOAD]', payload.toString('hex'), 'len:', payload.length);
        if (ioRef) ioRef.emit('feedback-info', payload);
      });
    });
  } else {
    console.log('[SERIAL][DEBUG] serialPort is not defined when trying to attach handler!');
  }
  if (wsClient) {
    wsClient.on('message', (data) => {
      if (Buffer.isBuffer(data)) {
        wsFeedbackBuffer = Buffer.concat([wsFeedbackBuffer, data]);
        wsFeedbackBuffer = processFeedbackBuffer(wsFeedbackBuffer, (payload) => {
          if (ioRef) ioRef.emit('feedback-info', payload);
        });
      }
    });
  }
}
// Wait for CMD_DEVICE_SETTINGS response and return parsed settings
function getDeviceSettingsFromSTM32(preferredTransport) {
  return new Promise(async (resolve, reject) => {
    try {
      // Listen for device-settings event ONCE
      const timeout = setTimeout(() => {
        if (ioRef) ioRef.off('device-settings', handler);
        reject(new Error('Timeout waiting for device settings from STM32'));
      }, 3000);
      function handler(data) {
        clearTimeout(timeout);
        if (ioRef) ioRef.off('device-settings', handler);
        console.log('[DeviceSettings] device-settings event received:', data);
        resolve(data); // Return the full structured object
      }
      if (ioRef) ioRef.on('device-settings', handler);
      await sendCommandToSTM32(CMD_GET_DEVICE_SETTINGS, undefined, preferredTransport);
    } catch (err) {
      reject(err);
    }
  });
}
// Add heartbeat logs to HistoryLog (TestLog) when device heartbeat is received
const TestLog = require('../models/HistoryLog');
const { SerialPort } = require('serialport');
const net = require('net');
const WebSocket = require('ws');
let noble = null;
try {
  noble = require('@abandonware/noble');
} catch (e) {
  console.warn('[BLE] @abandonware/noble not installed. BLE features are disabled.');
}

// STM32/ESP32 protocol constants
const PKT_HEADER = 0xAA;
const PKT_END = 0x55;
const PKT_MAX_PAYLOAD = 64;
const PKT_MAX_PACKET_SIZE = 5 + PKT_MAX_PAYLOAD;

// Command codes
const CMD_DEVICE_ONLINE = 0x01;
const CMD_GET_DEVICE_READY = 0x02;
const CMD_DEVICE_IS_READY = 0x03;
const CMD_SEND_SW_PARAMETERS = 0x04;
const CMD_DATA_ACK = 0x05;
const CMD_SET_DEVICE_SETTINGS = 0x06;
const CMD_GET_DEVICE_SETTINGS = 0x07;
const CMD_DEVICE_SETTINGS = 0x08;
// Feedback/ADC/statistics protocol
const CMD_GET_FEEDBACK_INFO = 0x09; // Request feedback/ADC/statistics (match STM32)
const CMD_FEEDBACK_INFO = 0x0A;     // Response with feedback/ADC/statistics (match STM32)
const CMD_GET_ADC = 0x22;           // Request raw ADC values
const CMD_ADC_DATA = 0x23;          // Response with ADC data
const CMD_GET_STAT = 0x24;          // Request statistics
const CMD_STAT_DATA = 0x25;         // Response with statistics

let serialPort;

// Import setupSerial from separate file
const { setupSerial } = require('./setupSerial');
let ioRef;
let wsClient;
let wsPingInterval;
let wsLastPongAt = 0;

// Buffer for incoming binary data
let serialBuffer = Buffer.alloc(0);
let wsBuffer = Buffer.alloc(0);


// Transport mode: 'auto' | 'wifi' | 'uart' | 'bluetooth'
let transportMode = 'auto';

// BLE variables and setupBLE are commented out (Bluetooth disabled)
let blePeripheral = null;
let bleCharacteristic = null;
let bleConnected = false;
let bleStatus = { connected: false, scanning: false, error: null };
const SERVICE_UUID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
const CHARACTERISTIC_UUID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
function setupBLE(io) {
  ioRef = io;
  if (!noble) {
    console.warn('[BLE] noble not available, skipping BLE setup.');
    return;
  }
  noble.on('stateChange', async (state) => {
    if (state === 'poweredOn') {
      bleStatus.scanning = true;
      noble.startScanning([SERVICE_UUID], false);
    } else {
      noble.stopScanning();
      bleStatus.scanning = false;
    }
  });
  noble.on('discover', async (peripheral) => {
    if (blePeripheral) return; // Already connected
    blePeripheral = peripheral;
    noble.stopScanning();
    bleStatus.scanning = false;
    peripheral.connect((err) => {
      if (err) {
        bleStatus.error = err.message;
        io.emit('device-error', 'BLE connect error: ' + err.message);
        return;
      }
      bleConnected = true;
      bleStatus.connected = true;
      io.emit('device-status', { online: true, via: 'bluetooth', status: 'ble_connected', timestamp: new Date().toISOString() });
      peripheral.discoverSomeServicesAndCharacteristics([SERVICE_UUID], [CHARACTERISTIC_UUID], (err, services, characteristics) => {
        if (err || !characteristics.length) {
          bleStatus.error = err ? err.message : 'Characteristic not found';
          io.emit('device-error', 'BLE discover error: ' + bleStatus.error);
          return;
        }
        bleCharacteristic = characteristics[0];
        // Subscribe to notifications
        bleCharacteristic.on('data', (data, isNotification) => {
          processIncomingBuffer(Buffer.from(data), 'bluetooth');
        });
        bleCharacteristic.subscribe((err) => {
          if (err) io.emit('device-error', 'BLE subscribe error: ' + err.message);
        });
      });
    });
    peripheral.on('disconnect', () => {
      bleConnected = false;
      bleStatus.connected = false;
      blePeripheral = null;
      bleCharacteristic = null;
      io.emit('device-status', { online: false, via: 'bluetooth', status: 'ble_disconnected', timestamp: new Date().toISOString() });
      noble.startScanning([SERVICE_UUID], false);
      bleStatus.scanning = true;
    });
  });
}

function normalizeTransportName(name) {
  if (!name) return undefined;
  const n = String(name).toLowerCase();
  if (n === 'wifi' || n === 'ws' || n === 'websocket') return 'wifi';
  if (n === 'uart' || n === 'serial' || n === 'com') return 'uart';
  if (n === 'tcp') return 'tcp';
  if (n === 'udp') return 'udp';
  if (n === 'bluetooth' || n === 'ble') return 'bluetooth';
let tcpClient;
let udpSocket;
let udpTarget;
function isTcpReady() {
  return !!(tcpClient && tcpClient.writable);
}

function isUdpReady() {
  return !!(udpSocket);
}
function setupTCP(io) {
  ioRef = io;
  const tcpHost = process.env.TCP_HOST || '127.0.0.1';
  const tcpPort = parseInt(process.env.TCP_PORT || '8080', 10);
  tcpClient = new net.Socket();
  tcpClient.connect(tcpPort, tcpHost, () => {
    console.log('TCP connected to', tcpHost, tcpPort);
    ioRef.emit('device-status', { online: true, via: 'tcp', status: 'tcp_connected', timestamp: new Date().toISOString() });
  });
  tcpClient.on('data', (data) => {
    tcpBuffer = Buffer.concat([tcpBuffer, data]);
    processIncomingBuffer(tcpBuffer, 'tcp');
  });
  tcpClient.on('close', () => {
    ioRef.emit('device-status', { online: false, via: 'tcp', status: 'tcp_disconnected', timestamp: new Date().toISOString() });
    setTimeout(() => setupTCP(io), 2000);
  });
  tcpClient.on('error', (err) => {
    ioRef.emit('device-error', `tcp-error: ${err.message}`);
  });
}

function setupUDP(io) {
  ioRef = io;
  const udpPort = parseInt(process.env.UDP_PORT || '8081', 10);
  udpSocket = dgram.createSocket('udp4');
  udpSocket.on('message', (msg, rinfo) => {
    udpBuffer = Buffer.concat([udpBuffer, msg]);
    processIncomingBuffer(udpBuffer, 'udp');
    udpTarget = { address: rinfo.address, port: rinfo.port };
  });
  udpSocket.on('error', (err) => {
    ioRef.emit('device-error', `udp-error: ${err.message}`);
  });
  udpSocket.bind(udpPort, () => {
    console.log('UDP server listening on port', udpPort);
    ioRef.emit('device-status', { online: true, via: 'udp', status: 'udp_listening', timestamp: new Date().toISOString() });
  });
}
  if (n === 'auto') return 'auto';
  return undefined;
}

function isBLEReady() {
  return !!(bleCharacteristic && bleConnected);
}

function isWsReady() {
  return !!(wsClient && wsClient.readyState === WebSocket.OPEN);
}
// TCP removed
function isSerialReady() {
  return !!(serialPort && serialPort.isOpen);
}

// TCP removed

function setupWS(io) {
  ioRef = io;
  let wsUrl = process.env.WS_URL;
  if (!wsUrl) {
    const host = process.env.WS_HOST || process.env.ESP_HOST;
    const port = process.env.WS_PORT || process.env.ESP_WS_PORT;
    const path = process.env.WS_PATH || '';
    const secure = String(process.env.WS_SECURE || '').toLowerCase() === 'true';
    if (host && port) {
      wsUrl = `${secure ? 'wss' : 'ws'}://${host}:${port}${path.startsWith('/') ? path : path ? '/' + path : ''}`;
    }
  }
  if (!wsUrl) return;

  const connect = () => {
    wsClient = new WebSocket(wsUrl, { perMessageDeflate: false });

    wsClient.on('open', () => {
      console.log('WebSocket connected to ESP at', wsUrl);
      ioRef.emit('device-status', {
        online: true,
        via: 'ws',
        status: 'ws_connected',
        timestamp: new Date().toISOString()
      });

      // Start keepalive ping
      wsLastPongAt = Date.now();
      const pingIntervalMs = parseInt(process.env.WS_PING_INTERVAL_MS || '15000', 10);
      const pongTimeoutMs = parseInt(process.env.WS_PONG_TIMEOUT_MS || '30000', 10);
      if (wsPingInterval) clearInterval(wsPingInterval);
      wsPingInterval = setInterval(() => {
        if (!wsClient || wsClient.readyState !== WebSocket.OPEN) return;
        try { wsClient.ping(); } catch (_) {}
        // If we haven't received a pong within timeout, force reconnect
        if (Date.now() - wsLastPongAt > pongTimeoutMs) {
          try { wsClient.terminate(); } catch (_) {}
        }
      }, pingIntervalMs);
    });

    wsClient.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      wsBuffer = Buffer.concat([wsBuffer, buf]);
      processIncomingBuffer(wsBuffer, 'ws');
    });

    wsClient.on('error', (err) => {
      ioRef.emit('device-error', `ws-error: ${err.message}`);
    });

    wsClient.on('pong', () => {
      wsLastPongAt = Date.now();
    });

    wsClient.on('close', () => {
      ioRef.emit('device-status', {
        online: false,
        via: 'ws',
        status: 'ws_disconnected',
        timestamp: new Date().toISOString()
      });
      if (wsPingInterval) {
        clearInterval(wsPingInterval);
        wsPingInterval = null;
      }
      // Reconnect with simple backoff
      setTimeout(connect, 2000);
    });
  };

  connect();
}

function processIncomingBuffer(buffer, source) {
  // Parse all complete packets from the buffer
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    if (buffer[offset] !== PKT_HEADER) {
      offset++;
      continue;
    }
    const cmd = buffer[offset + 1];
    const len = buffer[offset + 2];
    if (offset + 5 + len > buffer.length) break; // incomplete packet
    const payload = buffer.slice(offset + 3, offset + 3 + len);
    const checksum = buffer[offset + 3 + len];
    const end = buffer[offset + 4 + len];
    // Validate end byte and checksum
    let chk = 0;
    for (let i = 0; i < 3 + len; ++i) chk ^= buffer[offset + i];
    if (end === PKT_END && chk === checksum) {
      handlePacket({ cmd, payload, len, source });
      offset += 5 + len;
    } else {
      offset++;
    }
  }
  // Remove processed bytes from the appropriate buffer
  if (source === 'serial') {
    serialBuffer = buffer.slice(offset);
  // TCP removed
  } else if (source === 'ws') {
    wsBuffer = buffer.slice(offset);
  }
}

function handlePacket({ cmd, payload, len, source }) {
      // Save heartbeat deviceId to HistoryLog (TestLog)
      TestLog.create({
        deviceId: payload.toString('hex'),
        action: 'Device Heartbeat',
        parameters: { payload: payload.toString('hex'), source },
        timestamp: new Date(),
      }).catch(e => console.error('Failed to log heartbeat to TestLog:', e));
  // Emit high-level events to frontend
  switch (cmd) {
    case CMD_DEVICE_ONLINE:
      // ...existing code...

      // DEBUG: Log all incoming binary packets from STM32/ESP32
      function debugLogIncomingPacket(cmd, payload) {
        console.log(`[DEBUG] Incoming packet: CMD=0x${cmd.toString(16).padStart(2, '0').toUpperCase()}, PayloadLen=${payload.length}, Raw=${payload.toString('hex')}`);
      }
      const heartbeatData = {
        online: true, 
        payload: payload.toString('hex'),
        deviceId: payload.toString('hex'),
        timestamp: new Date().toISOString(),
        source: source,
        status: 'heartbeat_received',
        message: 'Device heartbeat - ready for commands'
      };
      ioRef.emit('device-status', heartbeatData);
      ioRef.emit('device-data', { 
        type: 'heartbeat',
        cmd: cmd,
        payload: payload.toString('hex'),
        deviceId: payload.toString('hex'),
        timestamp: new Date().toISOString(),
        status: 'heartbeat_received'
      });
      break;
    case CMD_DEVICE_IS_READY:
      // ...existing code...
      const readyData = {
        ready: true, 
        payload: payload.toString('hex'),
        deviceId: payload.toString('hex'),
        timestamp: new Date().toISOString(),
        source: source,
        status: 'device_ready',
        message: 'Device ready for next command'
      };
      ioRef.emit('device-ready', readyData);
      ioRef.emit('device-status', {
        online: true,
        ready: true,
        payload: payload.toString('hex'),
        deviceId: payload.toString('hex'),
        timestamp: new Date().toISOString(),
        source: source,
        status: 'device_ready',
        message: 'Device ready for next command'
      });
      break;
    case CMD_DATA_ACK:
      ioRef.emit('device-ack', { ack: true, payload: payload.toString('hex') });
      break;
    case CMD_DEVICE_SETTINGS: {
      // Debug log for payload length and element count
      console.log('[DeviceSettings] Raw payload:', payload.toString('hex'), 'Length:', payload.length);
      let pos = 0;
      try {
        const freefall = payload.readInt16LE(pos); pos += 2;
        const hptf = payload.readInt16LE(pos); pos += 2;
        const feedback_enabled = payload.readUInt8(pos); pos += 1;
        const feedback_tolerance = payload.readUInt8(pos) / 1000.0; pos += 1;
        const harmonic_val = payload.readUInt8(pos); pos += 1;
        const harmonic = harmonic_val === 1 ? 'HALF' : (harmonic_val === 2 ? 'QUARTER' : 'FULL');
        const duration_ms = payload.readUInt16LE(pos); pos += 2;
        const element_count = payload.readUInt8(pos); pos += 1;
        console.log('[DeviceSettings] Parsed element_count:', element_count, 'pos after header:', pos);
        const elements = [];
        for (let i = 0; i < element_count; i++) {
          if (pos + 11 > payload.length) {
            console.error(`[DeviceSettings] Malformed payload: not enough bytes for element ${i+1} (pos=${pos}, payload.length=${payload.length})`);
            break;
          }
          const symbol = payload.slice(pos, pos + 3).toString('ascii').replace(/\0+$/, ''); pos += 3;
          const vout_base = payload.readFloatLE(pos); pos += 4;
          const freq = payload.readUInt32LE(pos); pos += 4;
          elements.push({ symbol, vout_base, freq });
        }
        ioRef.emit('device-settings', {
          freefall,
          hptf,
          feedback_enabled: !!feedback_enabled,
          feedback_tolerance,
          harmonic,
          duration_ms,
          element_count,
          elements,
          raw: payload.toString('hex'),
          timestamp: new Date().toISOString(),
          source,
        });
      } catch (err) {
        console.error('[DeviceSettings] Error parsing device settings payload:', err, 'Payload:', payload.toString('hex'));
        ioRef.emit('device-settings', {
          error: 'Malformed device settings payload',
          raw: payload.toString('hex'),
          timestamp: new Date().toISOString(),
          source,
        });
      }
      break;
    }
    case CMD_FEEDBACK_INFO: {
      debugLogIncomingPacket(CMD_FEEDBACK_INFO, payload);
      console.log('[FeedbackInfo] Raw payload:', payload.toString('hex'), 'Length:', payload.length);
      // Parse feedback info payload as per STM32 structure
      try {
        if (payload.length !== 47) {
          throw new Error('Feedback info payload length is not 47 bytes');
        }
        let pos = 0;
        const feedback_enabled = payload.readUInt8(pos); pos += 1;
        const feedback_tolerance = payload.readFloatLE(pos); pos += 4;
        const correction_factor = payload.readUInt8(pos) / 100.0; pos += 1;
        const max_iterations = payload.readUInt8(pos); pos += 1;
        const settle_delay = payload.readUInt16LE(pos); pos += 2;
        const total_corrections = payload.readUInt32LE(pos); pos += 4;
        const successful_corrections = payload.readUInt32LE(pos); pos += 4;
        const failed_corrections = payload.readUInt32LE(pos); pos += 4;
        const total_iterations = payload.readUInt32LE(pos); pos += 4;
        const avg_error_before = payload.readFloatLE(pos); pos += 4;
        const avg_error_after = payload.readFloatLE(pos); pos += 4;
        const adc_vref = payload.readFloatLE(pos); pos += 4;
        const adc_res = payload.readUInt16LE(pos); pos += 2;
        const dac_res = payload.readUInt16LE(pos); pos += 2;
        const last_target_voltage = payload.readFloatLE(pos); pos += 4;
        const success_rate_percent = payload.readUInt16LE(pos) / 100.0; pos += 2;
        const parsed = {
          feedback_enabled: !!feedback_enabled,
          feedback_tolerance,
          correction_factor,
          max_iterations,
          settle_delay,
          total_corrections,
          successful_corrections,
          failed_corrections,
          total_iterations,
          avg_error_before,
          avg_error_after,
          adc_vref,
          adc_res,
          dac_res,
          last_target_voltage,
          success_rate_percent,
          raw: payload.toString('hex'),
          timestamp: new Date().toISOString(),
          source,
        };
        console.log('[FeedbackInfo] Parsed:', parsed);
        ioRef.emit('feedback-info', parsed);
        ioRef.emit('device-feedback', parsed); // NEW: emit as 'device-feedback' for new frontend
        // Save feedback to MongoDB
        try {
          const DeviceFeedback = require('../models/DeviceFeedback');
          DeviceFeedback.create({
            deviceId: parsed.deviceId || (parsed.source && parsed.source.deviceId) || 'unknown',
            feedback: parsed,
            receivedAt: new Date()
          });
        } catch (err) {
          console.error('Failed to save device feedback:', err);
        }
      } catch (err) {
        console.error('[FeedbackInfo] Error parsing feedback-info payload:', err, 'Payload:', payload.toString('hex'), 'Length:', payload.length);
        ioRef.emit('feedback-info', {
          error: 'Malformed feedback-info payload',
          raw: payload.toString('hex'),
          timestamp: new Date().toISOString(),
          source,
        });
      }
      break;
    }
    case CMD_ADC_DATA:
      // Parse payload as array of 16-bit unsigned integers (little-endian)
      const adcValues = [];
      for (let i = 0; i + 1 < payload.length; i += 2) {
        adcValues.push(payload.readUInt16LE(i));
      }
      ioRef.emit('adc-data', {
        cmd,
        raw: payload.toString('hex'),
        values: adcValues,
        timestamp: new Date().toISOString(),
        source,
      });
      break;
    case CMD_STAT_DATA:
      ioRef.emit('stat-data', {
        cmd,
        raw: payload.toString('hex'),
        timestamp: new Date().toISOString(),
        source,
        // TODO: parse actual statistics from payload
      });
      break;
    default:
      ioRef.emit('device-data', { 
        cmd, 
        payload: payload.toString('hex'),
        timestamp: new Date().toISOString(),
        source: source
      });
      break;
  }
}

function buildPacket(cmd, payload) {
  const len = payload ? payload.length : 0;
  const buf = Buffer.alloc(5 + len);
  buf[0] = PKT_HEADER;
  buf[1] = cmd;
  buf[2] = len;
  if (payload && len > 0) payload.copy(buf, 3);
  let chk = 0;
  for (let i = 0; i < 3 + len; ++i) chk ^= buf[i];
  buf[3 + len] = chk;
  buf[4 + len] = PKT_END;
  return buf;
}

async function getDeviceStatusFromSTM32(preferredTransport) {
  // Send CMD_GET_DEVICE_READY and wait for CMD_DEVICE_IS_READY
  return new Promise((resolve, reject) => {
    const packet = buildPacket(CMD_GET_DEVICE_READY);
    let resolved = false;
    const handler = data => {
      if (data.ready) {
        resolved = true;
        ioRef.off('device-ready', handler);
        resolve({ status: 'ready', payload: data.payload });
      }
    };
    ioRef.on('device-ready', handler);
    sendPacket(packet, preferredTransport);
    setTimeout(() => {
      if (!resolved) {
        ioRef.off('device-ready', handler);
        reject(new Error('Timeout waiting for device ready'));
      }
    }, 2000);
  });
}

async function sendCommandToSTM32(cmd, payload, preferredTransport) {
  // Always send a get device ready packet immediately before every command
  const readyPacket = buildPacket(CMD_GET_DEVICE_READY);
  console.log(`[SEND] DeviceReady (pre-command): ${readyPacket.toString('hex')} via ${preferredTransport || 'auto'}`);
  const readyResult = sendPacket(readyPacket, preferredTransport);
  console.log(`[SEND] DeviceReady (pre-command) sent via ${readyResult.via || 'unknown'}: ${readyResult.sent ? 'OK' : 'FAIL'} (${readyResult.error || ''})`);
  // Now send the actual command packet
  const packet = buildPacket(cmd, payload);
  console.log(`[SEND] Command: CMD=0x${cmd.toString(16).padStart(2, '0')} Payload=${payload ? payload.toString('hex') : ''} via ${preferredTransport || 'auto'}`);
  const result = sendPacket(packet, preferredTransport);
  console.log(`[SEND] Command sent via ${result.via || 'unknown'}: ${result.sent ? 'OK' : 'FAIL'} (${result.error || ''})`);
  return result;
}

function sendPacket(packet, preferredTransport) {
  const pref = normalizeTransportName(preferredTransport);
  const mode = pref || transportMode;

  // Forced modes: try only the selected transport
  if (mode === 'wifi') {
    if (isWsReady()) { wsClient.send(packet, { binary: true }); return { sent: true, via: 'ws' }; }
    return { sent: false, error: 'WiFi/WebSocket not connected' };
  }
  if (mode === 'uart') {
    if (isSerialReady()) { serialPort.write(packet); return { sent: true, via: 'serial' }; }
    return { sent: false, error: 'UART/Serial not connected' };
  }
  // TCP removed
  if (mode === 'bluetooth') {
    if (isBLEReady()) {
      bleCharacteristic.write(packet, false, (err) => {
        if (err) ioRef.emit('device-error', 'BLE write error: ' + err.message);
      });
      return { sent: true, via: 'bluetooth' };
    }
    return { sent: false, error: 'Bluetooth not connected' };
  }

  // Auto mode: prefer WS -> Serial -> BLE
  if (isWsReady()) { wsClient.send(packet, { binary: true }); return { sent: true, via: 'ws' }; }
  // TCP removed
  if (isSerialReady()) { serialPort.write(packet); return { sent: true, via: 'serial' }; }
  if (isBLEReady()) {
    bleCharacteristic.write(packet, false, (err) => {
      if (err) ioRef.emit('device-error', 'BLE write error: ' + err.message);
    });
    return { sent: true, via: 'bluetooth' };
  }
  return { sent: false, error: 'No connection to STM32/ESP32/BLE' };
}

function getTransportStatus() {
  return {
    ws: {
      connected: !!(wsClient && wsClient.readyState === WebSocket.OPEN),
      readyState: wsClient ? wsClient.readyState : undefined,
      lastPongAt: wsLastPongAt || undefined
    },
  // TCP removed
    serial: {
      connected: !!(serialPort && serialPort.isOpen)
    },
    bluetooth: {
      connected: bleStatus.connected,
      scanning: bleStatus.scanning,
      error: bleStatus.error
    }
  };
}

// Function to manually request device ready status
async function requestDeviceReady(preferredTransport) {
  const packet = buildPacket(CMD_GET_DEVICE_READY);
  sendPacket(packet, preferredTransport);
  
  return new Promise((resolve, reject) => {
    let resolved = false;
    const handler = data => {
      if (data.ready) {
        resolved = true;
        ioRef.off('device-ready', handler);
        resolve({ status: 'ready', payload: data.payload, timestamp: data.timestamp });
      }
    };
    ioRef.on('device-ready', handler);
    
    // Timeout after 3 seconds
    setTimeout(() => {
      if (!resolved) {
        ioRef.off('device-ready', handler);
        reject(new Error('Device ready request timeout'));
      }
    }, 3000);
  });
}

function setTransportMode(mode) {
  const normalized = normalizeTransportName(mode);
  if (!normalized) {
    throw new Error('Invalid transport mode');
  }
  transportMode = normalized;
  ioRef && ioRef.emit('device-status', {
    status: 'transport_mode_changed',
    transportMode: transportMode,
    timestamp: new Date().toISOString()
  });
  return transportMode;
}

function getTransportMode() {
  return transportMode;
}


function processFeedbackBuffer(buffer, emitEvent) {
  while (buffer.length >= FEEDBACK_INFO_PACKET_LEN) {
    if (buffer[0] !== 0xAA) {
      buffer = buffer.slice(1);
      continue;
    }
    if (buffer[1] !== FEEDBACK_INFO_CMD || buffer[2] !== FEEDBACK_INFO_PAYLOAD_LEN) {
      buffer = buffer.slice(1);
      continue;
    }
    if (buffer[FEEDBACK_INFO_PACKET_LEN - 1] !== 0x55) {
      buffer = buffer.slice(1);
      continue;
    }
    let checksum = 0;
    for (let i = 0; i < FEEDBACK_INFO_PACKET_LEN - 2; i++) {
      checksum ^= buffer[i];
    }
    if (checksum !== buffer[FEEDBACK_INFO_PACKET_LEN - 2]) {
      buffer = buffer.slice(1);
      continue;
    }
    const payload = buffer.slice(3, 3 + FEEDBACK_INFO_PAYLOAD_LEN);
    emitEvent(payload);
    buffer = buffer.slice(FEEDBACK_INFO_PACKET_LEN);
  }
  return buffer;
}


// --- Feedback Info Buffer Handlers (runtime code) ---
if (serialPort) {
  serialPort.on('data', (data) => {
    uartFeedbackBuffer = Buffer.concat([uartFeedbackBuffer, data]);
    uartFeedbackBuffer = processFeedbackBuffer(uartFeedbackBuffer, (payload) => {
      if (ioRef) ioRef.emit('feedback-info', payload);
    });
  });
}

let wsFeedbackBuffer = Buffer.alloc(0);
if (wsClient) {
  wsClient.on('message', (data) => {
    if (Buffer.isBuffer(data)) {
      wsFeedbackBuffer = Buffer.concat([wsFeedbackBuffer, data]);
      wsFeedbackBuffer = processFeedbackBuffer(wsFeedbackBuffer, (payload) => {
        if (ioRef) ioRef.emit('feedback-info', payload);
      });
    }
  });
}

module.exports = {
  setupSerial,
  setupWS,
  // setupBLE, // Bluetooth disabled
  getDeviceStatusFromSTM32,
  sendCommandToSTM32,
  requestDeviceReady,
  buildPacket,
  sendPacket,
  getTransportStatus,
  setTransportMode,
  getTransportMode,
  getDeviceSettingsFromSTM32,
  getFeedbackInfoFromSTM32,
  attachFeedbackBufferHandlers,
  CMD_GET_DEVICE_READY,
  CMD_SEND_SW_PARAMETERS,
  CMD_SET_DEVICE_SETTINGS,
  CMD_GET_DEVICE_SETTINGS,
  // Feedback/ADC/statistics protocol
  CMD_GET_FEEDBACK_INFO,
  CMD_FEEDBACK_INFO,
  CMD_GET_ADC,
  CMD_ADC_DATA,
  CMD_GET_STAT,
  CMD_STAT_DATA
};
