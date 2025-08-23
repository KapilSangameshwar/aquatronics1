// Setup serial port and attach feedback buffer handler

const { uartFeedbackBuffer, processFeedbackBuffer } = require('./deviceComm');

function setupSerial(io, portPath, baudRate = 115200) {
  const { SerialPort } = require('serialport');
  const SerialPortClass = require('serialport').SerialPort;
  const port = new SerialPortClass({
    path: portPath,
    baudRate: baudRate,
    autoOpen: true
  });
  ioRef = io;
  port.on('open', () => {
    console.log('Serial port opened:', portPath);
    io.emit('device-status', {
      online: true,
      via: 'serial',
      status: 'serial_connected',
      timestamp: new Date().toISOString()
    });
    // Attach buffer handlers after port is open
    const { attachFeedbackBufferHandlers } = require('./deviceComm');
    attachFeedbackBufferHandlers(port);
  });
  port.on('error', (err) => {
    io.emit('device-error', `serial-error: ${err.message}`);
  });
  // Serial data event handling is now managed in deviceComm.js to avoid circular dependency and errors.
}

module.exports.setupSerial = setupSerial;
