// src/index.js
// Agente WhatsApp - Jorge Dimas
// Stack: Baileys + Claude API + Railway

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
import qrcode from 'qrcode-terminal';
import { generateReply } from './agent.js';
import { setManual, setBot, isManual } from './memory.js';

// Logger silencioso (só erros aparecem)
const logger = pino({ level: 'silent' });

// Numeros bloqueados (nunca responde)
const BLOCKED = new Set(
  (process.env.BLOCKED_NUMBERS || '')
    .split(',')
    .map(n => n.trim())
    .filter(Boolean)
    .map(n => `${n}@s.whatsapp.net`)
);

// Delay entre receber e responder (simula digitacao humana)
function humanDelay(text = '') {
  const base = 1500;
  const perChar = 30;
  const ms = base + Math.min(text.length * perChar, 5000);
  return new Promise(r => setTimeout(r, ms + Math.random() * 1000));
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    printQRInTerminal: false, // vamos printar manualmente
    browser: ['Jorge Agente', 'Chrome', '120.0'],
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  // QR Code para autenticacao
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n========================================');
      console.log('  ESCANEIE O QR CODE ABAIXO NO CELULAR');
      console.log('  WhatsApp > Dispositivos Vinculados > +');
      console.log('========================================\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log('[WA] Conexao fechada. Motivo:', reason);

      if (reason === DisconnectReason.loggedOut) {
        console.log('[WA] Deslogado. Delete a pasta auth_info e reinicie.');
        process.exit(1);
      } else {
        console.log('[WA] Reconectando...');
        setTimeout(connectToWhatsApp, 3000);
      }
    }

    if (connection === 'open') {
      console.log('\n[WA] Conectado com sucesso!');
      console.log('[WA] Agente do Jorge ativo e monitorando mensagens...');
      console.log('[WA] Comandos: !manual (pausar bot) | !bot (reativar bot)\n');
    }
  });

  // Salva credenciais sempre que atualizar
  sock.ev.on('creds.update', saveCreds);

  // Listener principal de mensagens
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        await handleMessage(sock, msg);
      } catch (err) {
        console.error('[MSG] Erro ao processar mensagem:', err.message);
      }
    }
  });

  return sock;
}

async function handleMessage(sock, msg) {
  // Ignora mensagens do proprio usuario
  if (msg.key.fromMe) {
    await handleOutgoingCommands(msg);
    return;
  }

  // Ignora broadcasts e status
  if (isJidBroadcast(msg.key.remoteJid)) return;

  // Ignora grupos (pode mudar aqui se quiser responder grupos)
  if (isJidGroup(msg.key.remoteJid)) return;

  const jid = msg.key.remoteJid;
  const numero = jid.replace('@s.whatsapp.net', '');

  // Extrai o texto da mensagem
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    null;

  // Ignora mensagens sem texto (audio, figurinha, etc.)
  if (!text) {
    console.log(`[MSG] Mensagem nao-texto de ${numero} (ignorada pelo bot)`);
    return;
  }

  console.log(`[MSG] ${numero}: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);

  // Verifica se numero esta bloqueado
  if (BLOCKED.has(jid)) {
    console.log(`[BLOCK] Numero bloqueado, ignorando: ${numero}`);
    return;
  }

  // Verifica se esta em modo manual
  if (isManual(jid)) {
    console.log(`[MANUAL] Conversa em modo manual: ${numero}`);
    return;
  }

  // Gera resposta com Claude
  console.log(`[AGENT] Gerando resposta para ${numero}...`);
  const reply = await generateReply(jid, text);

  if (!reply) {
    console.log(`[AGENT] Sem resposta gerada para ${numero}`);
    return;
  }

  // Delay humano antes de responder
  await sock.sendPresenceUpdate('composing', jid);
  await humanDelay(reply);
  await sock.sendPresenceUpdate('paused', jid);

  // Envia a resposta
  await sock.sendMessage(jid, { text: reply });
  console.log(`[AGENT] Respondido ${numero}: "${reply.substring(0, 60)}${reply.length > 60 ? '...' : ''}"`);
}

// Detecta comandos enviados pelo proprio Jorge
async function handleOutgoingCommands(msg) {
  const jid = msg.key.remoteJid;
  if (!jid || isJidGroup(jid) || isJidBroadcast(jid)) return;

  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    '';

  const manual = process.env.MANUAL_PREFIX || '!manual';
  const bot = process.env.BOT_PREFIX || '!bot';

  if (text.startsWith(manual)) {
    setManual(jid);
    console.log(`[CMD] Modo manual ativado para: ${jid}`);
  } else if (text.startsWith(bot)) {
    setBot(jid);
    console.log(`[CMD] Bot reativado para: ${jid}`);
  }
}

// Inicia
connectToWhatsApp().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
