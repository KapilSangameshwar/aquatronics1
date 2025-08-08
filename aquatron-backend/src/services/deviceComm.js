const { SerialPort } = require('serialport');
const net = require('net');

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

// Buffer for incoming binary data
let serialBuffer = Buffer.alloc(0);
let tcpBuffer = Buffer.alloc(0);

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
    io.emit('device-error', err.message);
  });
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
  // Remove processed bytes
  if (source === 'serial') serialBuffer = buffer.slice(offset);
  else tcpBuffer = buffer.slice(offset);
}

function handlePacket({ cmd, payload, len, source }) {
  // Emit high-level events to frontend
  switch (cmd) {
    case CMD_DEVICE_ONLINE:
      console.log('Heartbeat received:', payload.toString('hex'));
      ioRef.emit('device-status', { online: true, payload: payload.toString('hex') });
      break;
    case CMD_DEVICE_IS_READY:
      ioRef.emit('device-ready', { ready: true, payload: payload.toString('hex') });
      break;
    case CMD_DATA_ACK:
      ioRef.emit('device-ack', { ack: true, payload: payload.toString('hex') });
      break;
    case CMD_DEVICE_SETTINGS:
      ioRef.emit('device-settings', { settings: payload.toString('hex') });
      break;
    default:
      ioRef.emit('device-data', { cmd, payload: payload.toString('hex') });
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

async function getDeviceStatusFromSTM32() {
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
    sendPacket(packet);
    setTimeout(() => {
      if (!resolved) {
        ioRef.off('device-ready', handler);
        reject(new Error('Timeout waiting for device ready'));
      }
    }, 2000);
  });
}

async function sendCommandToSTM32(cmd, payload) {
  // Send a command packet to STM32 (TCP preferred, fallback to serial)
  const packet = buildPacket(cmd, payload);
  return sendPacket(packet);
}

function sendPacket(packet) {
  if (tcpClient && !tcpClient.destroyed) {
    tcpClient.write(packet);
    return { sent: true, via: 'tcp' };
  } else if (serialPort && serialPort.isOpen) {
    serialPort.write(packet);
    return { sent: true, via: 'serial' };
  } else {
    return { sent: false, error: 'No connection to STM32/ESP32' };
  }
}

module.exports = {
  setupSerial,
  setupTCP,
  getDeviceStatusFromSTM32,
  sendCommandToSTM32,
  CMD_GET_DEVICE_READY,
  CMD_SEND_SW_PARAMETERS,
  CMD_SET_DEVICE_SETTINGS,
  CMD_GET_DEVICE_SETTINGS
};
