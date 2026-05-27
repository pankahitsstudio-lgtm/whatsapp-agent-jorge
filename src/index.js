import 'dotenv/config';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidGroup,
  jidNormalizedUser,
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

// Mapa de LID -> numero real
const lidToPhone = new Map();

// Contatos salvos na agenda (populado ao conectar)
const knownContacts = new Set();

// Verifica se e bloqueado
// LOGICA: bloqueia quem esta na lista BLOCKED_NUMBERS OU quem esta salvo como contato
function isBlocked(jid) {
  const numero = jid.split('@')[0];

  // 1. Checa lista manual de bloqueados
  const entries = (process.env.BLOCKED_NUMBERS || '')
    .split(',').map(n => n.trim()).filter(Boolean);
  if (entries.some(n => jid.includes(n))) return true;

  // 2. Checa via mapa LID
  if (jid.includes('@lid')) {
    const lid = jid.split('@')[0];
    const phone = lidToPhone.get(lid);
    if (phone && entries.some(n => phone.includes(n))) return true;
    // LID resolvido — checa apenas na lista de bloqueados manual
  }

  // Contatos conhecidos: so bloqueia se estiver na lista BLOCKED_NUMBERS
  // (nao bloqueia automaticamente toda a agenda)

  return false;
}

// Servidor HTTP
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const { number, message } = JSON.parse(body);
        if (!sockGlobal || !isConnected) { res.writeHead(503); res.end('{}'); return; }
        const jid = number.replace(/\D/g, '') + '@s.whatsapp.net';
        await sockGlobal.sendMessage(jid, { text: message });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(500); res.end('{}'); }
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
    <h1 style="color:#25d366">✅ Bot conectado!</h1></body></html>`);
    return;
  }
  if (!currentQR) {
    res.end(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="3"></head>
    <body style="background:#0d1117;color:#fff;font-family:sans-serif;text-align:center;padding:60px">
    <h2>Aguardando QR...</h2></body></html>`);
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
server.listen(PORT, '0.0.0.0', () => console.log(`[SERVER] Porta ${PORT}`));

function humanDelay(text = '') {
  return new Promise(r => setTimeout(r, 1500 + Math.min(text.length * 30, 5000) + Math.random() * 1000));
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

  // Popula contatos conhecidos (agenda) ao conectar e ao atualizar
  const loadContacts = (contacts) => {
    for (const c of contacts) {
      if (!c.id) continue;
      const numero = c.id.split('@')[0];
      // So adiciona contatos que tem nome salvo (estao na agenda)
      if (c.name || c.notify) {
        knownContacts.add(numero);
      }
      // Mapeia LID
      if (c.id.includes('@lid') && c.phoneNumber) {
        const phone = c.phoneNumber.replace(/\D/g, '');
        lidToPhone.set(numero, phone);
        if (c.name || c.notify) knownContacts.add(phone);
      }
    }
    console.log(`[CONTACTS] ${knownContacts.size} contatos conhecidos carregados`);
  };

  sock.ev.on('contacts.set', ({ contacts }) => loadContacts(contacts));
  sock.ev.on('contacts.upsert', (contacts) => loadContacts(contacts));
  sock.ev.on('contacts.update', (contacts) => loadContacts(contacts));

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) { currentQR = qr; isConnected = false; console.log('[QR] Novo QR gerado.'); }
    if (connection === 'close') {
      isConnected = false; currentQR = null; sockGlobal = null;
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) { console.log('[WA] Deslogado.'); process.exit(1); }
      else { console.log('[WA] Reconectando...'); setTimeout(connectToWhatsApp, 3000); }
    }
    if (connection === 'open') {
      currentQR = null; isConnected = true; sockGlobal = sock;
      console.log('[WA] ✅ Conectado! Agente ativo.');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Captura mensagens e popula mapa LID
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      // Tenta mapear LID de quem enviou
      try {
        const jid = msg.key.remoteJid || '';
        if (jid.includes('@lid') && msg.key.participant) {
          const participantPhone = msg.key.participant.split('@')[0].replace(/\D/g, '');
          const lid = jid.split('@')[0];
          if (participantPhone && !lidToPhone.has(lid)) {
            lidToPhone.set(lid, participantPhone);
          }
        }
        // Tambem tenta pelo pushName + verifyContact
        if (jid.includes('@lid')) {
          const lid = jid.split('@')[0];
          if (!lidToPhone.has(lid)) {
            try {
              const result = await sock.onWhatsApp(jid);
              if (result?.[0]?.jid) {
                const phone = result[0].jid.split('@')[0];
                lidToPhone.set(lid, phone);
                console.log(`[LID] Resolvido: ${lid} -> ${phone}`);
              }
            } catch(e) {}
          }
        }
      } catch(e) {}

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
  const numero = jid.split('@')[0];

  // Bloquear ANTES de qualquer processamento
  if (isBlocked(jid)) {
    console.log(`[BLOCK] Ignorado: ${numero}`);
    return;
  }
  if (isManual(jid)) {
    console.log(`[MANUAL] Ignorado: ${numero}`);
    return;
  }

  // Audio
  const isAudio = !!(msg.message?.audioMessage || msg.message?.pttMessage);
  if (isAudio) {
    await sock.sendPresenceUpdate('composing', jid);
    await new Promise(r => setTimeout(r, 1500));
    await sock.sendPresenceUpdate('paused', jid);
    await sock.sendMessage(jid, { text: 'Oi! No momento nao consigo ouvir audio. Pode mandar por escrito? Te respondo na hora!' });
    console.log(`[AUDIO] Aviso enviado para ${numero}`);
    return;
  }

  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || null;

  if (!text) return;
  console.log(`[MSG] ${numero}: "${text.substring(0, 60)}"`);

  // Se a pessoa quiser falar direto com o Jorge, bot para automaticamente
  const querJorge = /(com o jorge|direto|com ele|jorge mesmo|pessoalmente|falar com jorge)/i.test(text);
  if (querJorge) {
    await sock.sendPresenceUpdate('composing', jid);
    await humanDelay('Ok! Vou chamar o Jorge, um momento.');
    await sock.sendPresenceUpdate('paused', jid);
    await sock.sendMessage(jid, { text: 'Ok! Vou chamar o Jorge, um momento.' });
    setManual(jid);
    console.log(`[MANUAL] ${numero} escolheu falar com o Jorge. Bot pausado.`);
    return;
  }

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
