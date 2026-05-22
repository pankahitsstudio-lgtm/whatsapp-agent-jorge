// src/memory.js
// Gerencia o historico de conversa por contato

const MAX_MESSAGES = 20; // maximo de mensagens por contexto
const conversations = new Map();

// Contatos em modo manual (bot pausado)
const manualMode = new Set();

export function getHistory(jid) {
  if (!conversations.has(jid)) {
    conversations.set(jid, []);
  }
  return conversations.get(jid);
}

export function addMessage(jid, role, content) {
  const history = getHistory(jid);
  history.push({ role, content });

  // Mantém só as ultimas MAX_MESSAGES mensagens
  if (history.length > MAX_MESSAGES) {
    history.splice(0, history.length - MAX_MESSAGES);
  }
}

export function clearHistory(jid) {
  conversations.delete(jid);
}

export function setManual(jid) {
  manualMode.add(jid);
  console.log(`[MANUAL] Bot pausado para: ${jid}`);
}

export function setBot(jid) {
  manualMode.delete(jid);
  console.log(`[BOT] Bot reativado para: ${jid}`);
}

export function isManual(jid) {
  return manualMode.has(jid);
}

export function listManual() {
  return [...manualMode];
}
