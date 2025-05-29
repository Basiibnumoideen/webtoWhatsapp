
# WhatsApp Contact Form Bot 🤖

## 📌 Overview
A Node.js server that:  
1. Receives website contact form submissions  
2. Forwards them to WhatsApp via the Baileys library  
3. Maintains persistent connections with auto-reconnect  


---

## 🛠️ Full Code Implementation

### 1. Core Dependencies
```javascript
require('dotenv').config();
const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const express = require('express');
const mongoose = require('mongoose');
```

### 2. Server Configuration
```javascript
const app = express();
app.use(express.json());

// Constants
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_INTERVAL = 10000; 
const PORT = process.env.PORT || 3000;
```

### 3. WhatsApp Connection Manager
```javascript
let sock;
let qrGeneratedCount = 0;

async function connectToWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      browser: ['WhatsAppBot', 'Chrome', '1.0'],
      markOnlineOnConnect: false
    });

    // Connection event handlers
    sock.ev.on('connection.update', (update) => {
      if (update.qr) {
        qrGeneratedCount++;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(update.qr)}`;
        console.log(`🔗 QR CODE #${qrGeneratedCount}: ${qrUrl}`);
      }
      
      if (update.connection === 'close') {
        handleDisconnection();
      }
    });
  } catch (err) {
    console.error('Connection error:', err);
    setTimeout(connectToWhatsApp, RECONNECT_INTERVAL);
  }
}
```

### 4. API Endpoints
```javascript
// Contact Form Submission
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    
    await sock.sendMessage(process.env.ADMIN_JID, { 
      text: `📩 New Contact

Name: ${name}
Email: ${email}
Message: ${message}`
    });
    
    res.status(200).json({ success: true });
  } catch (err) {
    handleApiError(err, res);
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: sock?.user ? 'connected' : 'disconnected',
    qrGeneratedCount,
    lastActivity: new Date()
  });
});
```

### 5. Error Handling System
```javascript
function handleApiError(err, res) {
  console.error(`API Error: ${err.message}`);
  
  if (!sock?.user) {
    return res.status(503).json({
      error: 'WhatsApp disconnected',
      solution: 'Scan new QR code from logs'
    });
  }
  
  res.status(500).json({ error: 'Internal server error' });
}

process.on('uncaughtException', (err) => {
  console.error('⚠️ Critical Error:', err);
  setTimeout(() => process.exit(1), 1000);
});
```

---

## 🚀 Deployment Guide

### Environment Variables
```
ADMIN_JID=911234567890@s.whatsapp.net
MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/db
PORT=3000
```

### Render.com Setup

- Create new Web Service  
- Set build command: `npm install`  
- Set start command: `node index.js`  
- Add environment variables  
- Deploy!  

---

## 🔄 Connection Lifecycle

### Initial Connection
```bash
🌐 Server started
🔗 QR CODE #1: https://api.qrserver.com/... 
✅ WhatsApp Connected
```

### Disconnection
```bash
⚠️ Connection closed
♻️ Reconnecting (attempt 1/3)...
```

### QR Regeneration
```bash
🔄 QR CODE #2 (New connection required)
```

---

## 📋 API Reference

| Endpoint       | Method | Description               |
|----------------|--------|---------------------------|
| `/api/contact` | POST   | Submit contact form data  |
| `/health`      | GET    | Check bot status          |

### Example Request:
```bash
curl -X POST https://your-bot.onrender.com/api/contact   -H "Content-Type: application/json"   -d '{"name":"John","email":"john@doe.com","message":"Hello"}'
```

---

## 🛠 Troubleshooting

| Issue              | Solution                          |
|--------------------|---------------------------------|
| QR not scanning    | Use the clickable link from logs |
| Frequent disconnections | Upgrade to paid Render plan       |
| MongoDB errors      | Check connection string          |

---

## 📜 License

MIT © 2 Basi

---

Feel free to customize and extend this bot as needed!
