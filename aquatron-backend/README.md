# AQUATRON Backend

Node.js/Express backend for STM32 aquaponics/hydroponics control system.

## Features
- JWT authentication & RBAC
- MongoDB for users, command history
- Real-time updates via socket.io
- UART (serialport) & TCP (net) communication with STM32
- Modular, production-ready structure

## Setup
1. Copy `.env.example` to `.env` and fill in your values.
2. Run `npm install`.
3. Start with `npm run dev` (development) or `npm start` (production).

## ESP WebSocket transport

The backend can send/receive binary packets to your ESP device over Wi‑Fi via WebSocket. This complements the existing TCP and Serial transports. The send order preference is: WebSocket → TCP → Serial.

### Env variables

Add one of the following to `.env` in `aquatron-backend`:

```
# Direct URL
WS_URL=ws://192.168.4.1:81

# Or build URL from parts
WS_HOST=192.168.4.1
WS_PORT=81
WS_PATH=/ws
WS_SECURE=false

# Optional keepalive
WS_PING_INTERVAL_MS=15000
WS_PONG_TIMEOUT_MS=30000

# Existing transports (optional)
TCP_HOST=192.168.4.1
TCP_PORT=9000
SERIAL_PORT=COM3
SERIAL_BAUD=115200
```

### Events emitted to frontend

The backend emits via Socket.IO:

- `device-status`: online/ready changes, including ws/tcp/serial status
- `device-data`: raw parsed packets
- `device-ready`: device signaled ready
- `device-ack`: ACK packets
- `device-settings`: settings packets

### REST endpoints

- `GET /api/device/transport-status` — returns current ws/tcp/serial connection booleans
- `GET /api/device/transport-mode` — returns current mode: auto | wifi | uart | tcp
- `POST /api/device/transport-mode { mode }` — set mode (admin). Per-request override also supported via body: `{ transport: 'wifi' }` or header `x-transport: wifi`.
- `POST /api/device/ready` — triggers ready request
- `POST /api/device/sw-parameters` — sends SW parameters
- `POST /api/device/settings` — updates device settings
