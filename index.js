require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const P = require('pino');
const express = require('express');
const bodyParser = require('body-parser');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const fetch = require('node-fetch');

const { handleContactCommand, addContact } = require('./modules/contact');
const { sendHelp } = require('./modules/help');

const app = express();
app.use(bodyParser.json());

const logger = P({ level: 'silent', transport: { target: 'pino-pretty', options: { colorize: true } } });

let sock;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
let lastActivity = Date.now();
let latestQR = null;
let state, saveCreds;

// ==================
// KEEP-ALIVE SYSTEM
// ==================

function setupKeepAlive() {
  const APP_URL = process.env.APP_URL || `https://your-app-name.onrender.com`;
  
  cron.schedule('*/10 * * * *', async () => {
    try {
      await fetch(`${APP_URL}/health`);
      console.log('🏓 Keep-alive ping sent');
    } catch (err) {
      console.log('⚠️ Keep-alive ping failed:', err.message);
    }
  });
}

function startHeartbeat() {
  setInterval(async () => {
    if (sock?.user) {
      try {
        await sock.sendPresenceUpdate('available');
        lastActivity = Date.now();
        console.log('💓 WhatsApp heartbeat sent');
      } catch (err) {
        console.log('⚠️ Heartbeat failed:', err.message);
        if (Date.now() - lastActivity > 300000) {
          console.log('🔄 Connection seems dead, reconnecting...');
          connectToWhatsApp();
        }
      }
    }
  }, 60000);
}

// ==================
// WHATSAPP CONNECTION
// ==================

async function initializeAuth() {
  ({ state, saveCreds } = await useMultiFileAuthState('./auth'));
}

async function connectToWhatsApp() {
  try {
    console.log('🔌 Connecting to WhatsApp...');
    
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger,
      browser: ['Ubuntu', 'Chrome', '22.04'],
      printQRInTerminal: false,
      keepAliveIntervalMs: 10000,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
    });

    global.whatsappSock = sock;
    global.adminJid = process.env.ADMIN_JID;

    sock.ev.on('connection.update', async (update) => {
      const { qr, connection, lastDisconnect } = update;

      if (qr) {
        latestQR = qr;
        qrcode.generate(qr, { small: false });
        
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
        console.log("📷 QR Code URL:");
        console.log(`🔗 ${qrImageUrl}`);
      }

      if (connection === 'open') {
        console.log('✅ WhatsApp Connected Successfully');
        reconnectAttempts = 0;
        lastActivity = Date.now();
        
        if (global.adminJid) {
          try {
            await sock.sendMessage(global.adminJid, {
              text: `🤖 *Bot Online*\n\n✅ Connected at: ${new Date().toLocaleString()}\n🌐 Server: ${process.env.RENDER_SERVICE_NAME || 'Local'}`
            });
          } catch (err) {
            console.log('Could not send startup notification');
          }
        }
      }

      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;
        console.log(`❌ Connection closed. Reason: ${reason}`);
        
        if (reason === DisconnectReason.loggedOut) {
          console.log('🔑 Logged out. Clearing auth state and reconnecting...');
          await initializeAuth(); // Re-initialize auth state
          connectToWhatsApp(); // Attempt to reconnect
        } else if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          
          console.log(`🔄 Reconnecting in ${delay/1000}s... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
          
          setTimeout(connectToWhatsApp, delay);
        } else {
          console.error('❌ Max reconnection attempts reached');
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (msg) => {
      const m = msg.messages[0];
      if (!m.message || m.key.fromMe) return;

      const sender = m.key.remoteJid;
      const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
      const lowerText = text.toLowerCase().trim();

      lastActivity = Date.now();

      try {
        console.log(`📩 Message from ${sender}: ${text}`);
        
        if (lowerText === '/help') return sendHelp(sock, sender);
        if (lowerText.startsWith('/contact')) return handleContactCommand(lowerText, sock, sender);
        if (lowerText === '/status') {
          const uptime = process.uptime();
          const hours = Math.floor(uptime / 3600);
          const minutes = Math.floor((uptime % 3600) / 60);
          return sock.sendMessage(sender, {
            text: `🤖 *Bot Status*\n\n✅ Online\n⏱️ Uptime: ${hours}h ${minutes}m\n📱 Connected: ${sock.user ? 'Yes' : 'No'}`
          });
        }

        await sock.sendMessage(sender, {
          text: `🤖 I'm a simple bot. Here's what I can do:\n\n` +
                `/help - Show help menu\n` +
                `/contact - Contact commands\n` +
                `/status - Check bot status\n\n` +
                `Try one of these commands!`
        });
      } catch (err) {
        console.error('Message handling error:', err);
      }
    });

    sock.ev.on('CB:call', async (call) => {
      console.log('📞 Call received, declining...');
      await sock.rejectCall(call.id, call.from);
    });

  } catch (err) {
    console.error('❌ Connection error:', err);
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      setTimeout(connectToWhatsApp, 5000);
    }
  }
}

// =================
// API Endpoints
// =================
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const newContact = addContact(req.body);
    const whatsappMsg = `📩 *New Contact*\n\n` +
                        `🆔 ID: ${newContact.id}\n` +
                        `👤 Name: ${name}\n` +
                        `📧 Email: ${email}\n` +
                        `📝 Subject: ${subject}\n` +
                        `💬 Message: ${message}`;

    if (sock && global.adminJid) {
      await sock.sendMessage(global.adminJid, { text: whatsappMsg });
    }
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Contact API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (req, res) => {
  const status = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    whatsapp: sock?.user ? 'connected' : 'disconnected',
    lastActivity: new Date(lastActivity).toISOString()
  };
  res.status(200).json(status);
});

app.get('/qr', (req, res) => {
  if (latestQR) {
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(latestQR)}`;
    res.redirect(qrImageUrl);
  } else {
    res.json({ message: 'No QR code available. Bot might be connected already.' });
  }
});

app.get('/wake', (req, res) => {
  res.json({ 
    message: 'Bot is awake!', 
    timestamp: new Date().toISOString(),
    connected: sock?.user ? true : false 
  });
});

// =================
// Server Startup
// =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🌐 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  setupKeepAlive();
  startHeartbeat();
  
  await initializeAuth();
  connectToWhatsApp().catch(err => {
    console.error('❌ Initial connection failed:', err);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Shutting down gracefully...');
  if (sock) {
    sock.end();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received. Shutting down gracefully...');
  if (sock) {
    sock.end();
  }
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('⚠️ Unhandled Rejection:', err);
});
