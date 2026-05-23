// src/index.js - Agente WhatsApp Jorge Dimas
import 'dotenv/config';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidGroup,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import http from 'http';
import { generateReply } from './agent.js';
import { setManual, setBot, isManual } from './memory.js';

const logger = pino({ level: 'silent' });

let currentQR = null;
let isConnected = false;
let sockGlobal = null;

// Servidor HTTP
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

  // Endpoint para enviar mensagem proativa
  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { number, message } = JSON.parse(body);
        if (!sockGlobal || !isConnected) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Bot nao conectado' }));
          return;
        }
        const jid = number.replace(/\D/g, '') + '@s.whatsapp.net';
        await sockGlobal.sendMessage(jid, { text: message });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, to: jid }));
        console.log(`[SEND] Mensagem enviada para ${jid}`);
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ connected: isConnected, hasQR: !!currentQR }));
    return;
  }

  if (req.url === '/qr-data' && currentQR) {
    try {
      const qrDataUrl = await QRCode.toDataURL(currentQR);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ qr: qrDataUrl, connected: isConnected }));
    } catch(e) { res.writeHead(500); res.end('{}'); }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (isConnected) {
    res.end(`<!DOCTYPE html><html><body style="background:#0d1117;color:#fff;font-family:sans-serif;text-align:center;padding:60px">
    <h1 style="color:#25d366">✅ Bot conectado!</h1><p>Agente do Jorge ativo.</p></body></html>`);
    return;
  }
  if (!currentQR) {
    res.end(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="3"></head>
    <body style="background:#0d1117;color:#fff;font-family:sans-serif;text-align:center;padding:60px">
    <h2>Aguardando QR code...</h2><script>setTimeout(()=>location.reload(),3000)</script></body></html>`);
    return;
  }
  try {
    const qrImageUrl = await QRCode.toDataURL(currentQR, { width: 300 });
    res.end(`<!DOCTYPE html><html><body style="background:#0d1117;text-align:center;padding:40px;font-family:sans-serif">
    <h2 style="color:#fff">Escaneie com o WhatsApp</h2>
    <p style="color:#aaa">WhatsApp → ··· → Dispositivos Vinculados → Vincular dispositivo</p>
    <div style="display:inline-block;padding:16px;background:white;border-radius:16px">
      <img src="${qrImageUrl}" style="width:280px;height:280px;display:block">
    </div>
    <script>setTimeout(()=>location.reload(),25000)</script></body></html>`);
  } catch(e) { res.writeHead(500); res.end('Erro'); }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Porta ${PORT} ativa`);
});

const BLOCKED = new Set(
  (process.env.BLOCKED_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean).map(n => `${n}@s.whatsapp.net`)
);

function humanDelay(text = '') {
  const ms = 1500 + Math.min(text.length * 30, 5000);
  return new Promise(r => setTimeout(r, ms + Math.random() * 1000));
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version, logger, auth: state,
    printQRInTerminal: false,
    browser: ['JorgeAgente', 'Chrome', '120.0'],
    syncFullHistory: false,
  });

  sockGlobal = sock;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) { currentQR = qr; isConnected = false; console.log('[QR] Novo QR gerado.'); }
    if (connection === 'close') {
      isConnected = false; currentQR = null; sockGlobal = null;
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) { console.log('[WA] Deslogado.'); process.exit(1); }
      else { console.log('[WA] Desconectado (' + reason + '). Reconectando...'); setTimeout(connectToWhatsApp, 3000); }
    }
    if (connection === 'open') {
      currentQR = null; isConnected = true; sockGlobal = sock;
      console.log('[WA] ✅ Conectado! Agente ativo.');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try { await handleMessage(sock, msg); }
      catch (err) { console.error('[MSG] Erro:', err.message); }
    }
  });

  return sock;
}

async function handleMessage(sock, msg) {
  if (msg.key.fromMe) { await handleOutgoingCommands(msg); return; }
  if (isJidBroadcast(msg.key.remoteJid)) return;
  if (isJidGroup(msg.key.remoteJid)) return;

  const jid = msg.key.remoteJid;
  const numero = jid.replace('@s.whatsapp.net', '');
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || null;

  if (!text) return;
  console.log(`[MSG] ${numero}: "${text.substring(0, 60)}"`);
  if (BLOCKED.has(jid) || isManual(jid)) return;

  const reply = await generateReply(jid, text);
  if (!reply) return;

  await sock.sendPresenceUpdate('composing', jid);
  await humanDelay(reply);
  await sock.sendPresenceUpdate('paused', jid);
  await sock.sendMessage(jid, { text: reply });
  console.log(`[AGENT] → ${numero}: "${reply.substring(0, 60)}"`);
}

async function handleOutgoingCommands(msg) {
  const jid = msg.key.remoteJid;
  if (!jid || isJidGroup(jid) || isJidBroadcast(jid)) return;
  const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
  if (text.startsWith(process.env.MANUAL_PREFIX || '!manual')) setManual(jid);
  else if (text.startsWith(process.env.BOT_PREFIX || '!bot')) setBot(jid);
}

connectToWhatsApp().catch(err => { console.error('[FATAL]', err); process.exit(1); });
