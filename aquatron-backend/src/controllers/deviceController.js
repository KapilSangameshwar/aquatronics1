const {
  sendCommandToSTM32,
  getDeviceStatusFromSTM32,
  CMD_GET_DEVICE_READY,
  CMD_SEND_SW_PARAMETERS,
  CMD_SET_DEVICE_SETTINGS,
  CMD_GET_DEVICE_SETTINGS
} = require('../services/deviceComm');

const TestLog = require('../models/Testlog'); // ✅ New import

// Helper to convert hex string to Buffer
function hexToBuffer(hex) {
  if (!hex) return Buffer.alloc(0);
  return Buffer.from(hex, 'hex');
}

exports.getDeviceStatus = async (req, res, next) => {
  try {
    const status = await getDeviceStatusFromSTM32();
    res.json(status);
  } catch (err) { next(err); }
};

// Helper: build payload for CMD_SEND_SW_PARAMETERS
function buildSWParametersPayload(elements) {
  if (!Array.isArray(elements) || elements.length < 1 || elements.length > 5) {
    throw new Error('Invalid elements array');
  }
  const payload = Buffer.alloc(1 + elements.length * 4);
  payload[0] = elements.length;
  elements.forEach((el, i) => {
    payload[1 + i * 4] = el.symbol.charCodeAt(0);
    payload[2 + i * 4] = el.symbol.charCodeAt(1);
    payload[3 + i * 4] = el.quantity & 0xFF;
    payload[4 + i * 4] = (el.quantity >> 8) & 0xFF;
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
    const { cmd, elements, settings } = req.body;
    let payload = Buffer.alloc(0);

    if (cmd === CMD_SEND_SW_PARAMETERS) {
      payload = buildSWParametersPayload(elements);
    } else if (cmd === CMD_SET_DEVICE_SETTINGS) {
      payload = buildDeviceSettingsPayload(settings);
    }

    const result = await sendCommandToSTM32(cmd, payload);

    // ✅ Save test log (if user is logged in)
    if (req.user && req.user._id) {
      await TestLog.create({
        user: req.user._id,
        command: cmd,
        elements: elements || undefined,
        settings: settings || undefined
      });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.getDeviceSettings = async (req, res, next) => {
  try {
    const result = await sendCommandToSTM32(CMD_GET_DEVICE_SETTINGS);
    res.json(result);
  } catch (err) { next(err); }
};

exports.setDeviceSettings = async (req, res, next) => {
  try {
    const payload = buildDeviceSettingsPayload(req.body);
    const result = await sendCommandToSTM32(CMD_SET_DEVICE_SETTINGS, payload);
    res.json(result);
  } catch (err) { next(err); }
};

exports.sendSWParameters = async (req, res, next) => {
  try {
    const payload = buildSWParametersPayload(req.body.elements);
    const result = await sendCommandToSTM32(CMD_SEND_SW_PARAMETERS, payload);
    res.json(result);
  } catch (err) { next(err); }
};
