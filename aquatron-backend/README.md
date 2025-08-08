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
