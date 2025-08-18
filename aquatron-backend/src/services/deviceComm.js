// Add heartbeat logs to HistoryLog (TestLog) when device heartbeat is received
const TestLog = require('../models/HistoryLog');
const { SerialPort } = require('serialport');
const net = require('net');
const WebSocket = require('ws');
const noble = require('@abandonware/noble');

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

let serialPort;
let tcpClient;
let ioRef;
let wsClient;
let wsPingInterval;
let wsLastPongAt = 0;

// Buffer for incoming binary data
let serialBuffer = Buffer.alloc(0);
let tcpBuffer = Buffer.alloc(0);
let wsBuffer = Buffer.alloc(0);


// Transport mode: 'auto' | 'wifi' | 'uart' | 'tcp' | 'bluetooth'
let transportMode = 'auto';

// BLE variables
let blePeripheral = null;
let bleCharacteristic = null;
let bleConnected = false;
let bleStatus = { connected: false, scanning: false, error: null };

// Replace with your STM32 BLE UUIDs
const SERVICE_UUID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
const CHARACTERISTIC_UUID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
function setupBLE(io) {
  ioRef = io;
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
  if (n === 'tcp' || n === 'net') return 'tcp';
  if (n === 'bluetooth' || n === 'ble') return 'bluetooth';
  if (n === 'auto') return 'auto';
  return undefined;
function isBLEReady() {
  return !!(bleCharacteristic && bleConnected);
}
}

function isWsReady() {
  return !!(wsClient && wsClient.readyState === WebSocket.OPEN);
}
function isTcpReady() {
  return !!(tcpClient && !tcpClient.destroyed);
}
function isSerialReady() {
  return !!(serialPort && serialPort.isOpen);
}

function setupSerial(io) {
  ioRef = io;
  if (!process.env.SERIAL_PORT) return;
  serialPort = new SerialPort({
    path: process.env.SERIAL_PORT,
    baudRate: parseInt(process.env.SERIAL_BAUD) || 115200,
    autoOpen: true
  });
  serialPort.on('data', data => {
    serialBuffer = Buffer.concat([serialBuffer, data]);
    processIncomingBuffer(serialBuffer, 'serial');
  });
  serialPort.on('error', err => {
    io.emit('device-error', err.message);
  });
}

function setupTCP(io) {
  ioRef = io;
  if (!process.env.TCP_HOST || !process.env.TCP_PORT) return;
  tcpClient = new net.Socket();
  tcpClient.connect(parseInt(process.env.TCP_PORT), process.env.TCP_HOST, () => {
    console.log('TCP connected to STM32');
  });
  tcpClient.on('data', data => {
    tcpBuffer = Buffer.concat([tcpBuffer, data]);
    processIncomingBuffer(tcpBuffer, 'tcp');
  });
  tcpClient.on('error', err => {
    ioRef.emit('device-error', err.message);
  });
}

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
  } else if (source === 'tcp') {
    tcpBuffer = buffer.slice(offset);
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
      console.log('Heartbeat received:', payload.toString('hex'));
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
      // Also emit as device-data for consistency
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
      console.log('Device ready signal received:', payload.toString('hex'));
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
      // Also emit as device-status to update the overall status
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
    case CMD_DEVICE_SETTINGS:
      ioRef.emit('device-settings', { settings: payload.toString('hex') });
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
  // Send a command packet to STM32 (TCP preferred, fallback to serial)
  const packet = buildPacket(cmd, payload);
  const result = sendPacket(packet, preferredTransport);
  
  // For commands that require device ready response, wait for ready signal
  if (cmd === CMD_SEND_SW_PARAMETERS || cmd === CMD_SET_DEVICE_SETTINGS) {
    // Wait for device ready response
    return new Promise((resolve, reject) => {
      let resolved = false;
      const handler = data => {
        if (data.ready) {
          resolved = true;
          ioRef.off('device-ready', handler);
          
          // After receiving device ready, start listening for heartbeat packets again
          console.log('Device ready received, resuming heartbeat monitoring...');
          
          // Emit a status update to indicate ready for next input
          ioRef.emit('device-status', { 
            online: true, 
            ready: true,
            status: 'ready_for_next_input',
            message: 'Device ready for next command',
            timestamp: new Date().toISOString()
          });
          
          resolve({ ...result, deviceReady: true, readyPayload: data.payload, status: 'ready_for_next_input' });
        }
      };
      ioRef.on('device-ready', handler);
      
      // Timeout after 5 seconds
      setTimeout(() => {
        if (!resolved) {
          ioRef.off('device-ready', handler);
          resolve({ ...result, deviceReady: false, error: 'Device ready timeout' });
        }
      }, 5000);
    });
  }
  
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
  if (mode === 'tcp') {
    if (isTcpReady()) { tcpClient.write(packet); return { sent: true, via: 'tcp' }; }
    return { sent: false, error: 'TCP not connected' };
  }
  if (mode === 'bluetooth') {
    if (isBLEReady()) {
      bleCharacteristic.write(packet, false, (err) => {
        if (err) ioRef.emit('device-error', 'BLE write error: ' + err.message);
      });
      return { sent: true, via: 'bluetooth' };
    }
    return { sent: false, error: 'Bluetooth not connected' };
  }

  // Auto mode: prefer WS -> TCP -> Serial -> BLE
  if (isWsReady()) { wsClient.send(packet, { binary: true }); return { sent: true, via: 'ws' }; }
  if (isTcpReady()) { tcpClient.write(packet); return { sent: true, via: 'tcp' }; }
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
    tcp: {
      connected: !!(tcpClient && !tcpClient.destroyed)
    },
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

module.exports = {
  setupSerial,
  setupTCP,
  setupWS,
  setupBLE,
  getDeviceStatusFromSTM32,
  sendCommandToSTM32,
  requestDeviceReady,
  buildPacket,
  sendPacket,
  getTransportStatus,
  setTransportMode,
  getTransportMode,
  CMD_GET_DEVICE_READY,
  CMD_SEND_SW_PARAMETERS,
  CMD_SET_DEVICE_SETTINGS,
  CMD_GET_DEVICE_SETTINGS
};
