// src/index.js - Agente WhatsApp Jorge Dimas
// Baileys + Claude AI + Railway

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

// QR code atual (para servir via HTTP)
let currentQR = null;
let isConnected = false;

// Servidor HTTP simples para exibir o QR code
const server = http.createServer(async (req, res) => {
  if (req.url === '/qr') {
    if (isConnected) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="background:#111;color:#0f0;font-family:sans-serif;text-align:center;padding:50px"><h1>✅ Bot conectado!</h1><p>O agente esta ativo e respondendo mensagens.</p></body></html>');
      return;
    }
    if (!currentQR) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:50px"><h1>Aguardando QR code...</h1><p>Recarregue em alguns segundos.</p><script>setTimeout(()=>location.reload(),3000)</script></body></html>');
      return;
    }
    try {
      const qrImageUrl = await QRCode.toDataURL(currentQR);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="background:#111;text-align:center;padding:30px">
        <h2 style="color:#fff;font-family:sans-serif">Escaneie com o WhatsApp</h2>
        <p style="color:#aaa;font-family:sans-serif">WhatsApp → Dispositivos Vinculados → + Vincular dispositivo</p>
        <img src="${qrImageUrl}" style="width:280px;height:280px;border:8px solid white;border-radius:12px">
        <p style="color:#aaa;font-family:sans-serif;font-size:12px">QR code expira em ~60s. Se expirar, recarregue.</p>
        <script>setTimeout(()=>location.reload(),30000)</script>
      </body></html>`);
    } catch(e) {
      res.writeHead(500); res.end('Erro ao gerar QR');
    }
    return;
  }
  res.writeHead(302, { Location: '/qr' });
  res.end();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] QR Code disponivel em: http://localhost:${PORT}/qr`);
  console.log(`[SERVER] No Railway, acesse pelo dominio publico do servico + /qr`);
});

// Numeros bloqueados
const BLOCKED = new Set(
  (process.env.BLOCKED_NUMBERS || '')
    .split(',').map(n => n.trim()).filter(Boolean)
    .map(n => `${n}@s.whatsapp.net`)
);

// Delay humano
function humanDelay(text = '') {
  const ms = 1500 + Math.min(text.length * 30, 5000);
  return new Promise(r => setTimeout(r, ms + Math.random() * 1000));
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    printQRInTerminal: true,
    browser: ['Jorge Agente', 'Chrome', '120.0'],
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      isConnected = false;
      console.log('\n[QR] Novo QR code gerado. Acesse /qr no navegador para escanear.\n');
    }

    if (connection === 'close') {
      isConnected = false;
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log('[WA] Conexao fechada. Motivo:', reason);
      if (reason === DisconnectReason.loggedOut) {
        console.log('[WA] Deslogado. Delete auth_info e reinicie.');
        process.exit(1);
      } else {
        console.log('[WA] Reconectando em 3s...');
        setTimeout(connectToWhatsApp, 3000);
      }
    }

    if (connection === 'open') {
      currentQR = null;
      isConnected = true;
      console.log('[WA] ✅ Conectado! Agente ativo e monitorando mensagens.');
      console.log('[WA] Comandos: !manual (pausar bot) | !bot (reativar)\n');
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

  if (!text) { console.log(`[MSG] Midia de ${numero} (ignorada)`); return; }

  console.log(`[MSG] ${numero}: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);

  if (BLOCKED.has(jid)) return;
  if (isManual(jid)) { console.log(`[MANUAL] ${numero} em modo manual`); return; }

  console.log(`[AGENT] Gerando resposta para ${numero}...`);
  const reply = await generateReply(jid, text);
  if (!reply) return;

  await sock.sendPresenceUpdate('composing', jid);
  await humanDelay(reply);
  await sock.sendPresenceUpdate('paused', jid);
  await sock.sendMessage(jid, { text: reply });
  console.log(`[AGENT] → ${numero}: "${reply.substring(0, 60)}${reply.length > 60 ? '...' : ''}"`);
}

async function handleOutgoingCommands(msg) {
  const jid = msg.key.remoteJid;
  if (!jid || isJidGroup(jid) || isJidBroadcast(jid)) return;
  const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
  const manual = process.env.MANUAL_PREFIX || '!manual';
  const bot = process.env.BOT_PREFIX || '!bot';
  if (text.startsWith(manual)) setManual(jid);
  else if (text.startsWith(bot)) setBot(jid);
}

connectToWhatsApp().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
