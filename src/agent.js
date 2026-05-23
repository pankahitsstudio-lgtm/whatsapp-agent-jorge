// src/agent.js

import Anthropic from '@anthropic-ai/sdk';
import { buildPrompt } from './prompt.js';
import { getHistory, addMessage } from './memory.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';

// Le datas ocupadas da variavel de ambiente BUSY_DATES
// Formato: "15/06/2026,16/06/2026,04/07/2026"
function getBusyDates() {
  const raw = process.env.BUSY_DATES || '';
  return raw.split(',').map(d => d.trim()).filter(Boolean);
}

// Detecta se mensagem menciona alguma data
function hasDates(text) {
  return /(\d{1,2})[\/\-](\d{1,2})|dia\s+\d{1,2}|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro/i.test(text);
}

export async function generateReply(jid, incomingText) {
  const datetime = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short',
  });

  // Injeta info de disponibilidade se mensagem tiver datas
  let calendarContext = '';
  if (hasDates(incomingText)) {
    const busy = getBusyDates();
    if (busy.length > 0) {
      calendarContext = `\n\n[AGENDA SUITETOP — datas OCUPADAS/reservadas: ${busy.join(', ')}. Qualquer outra data esta LIVRE.]`;
    } else {
      calendarContext = '\n\n[AGENDA SUITETOP — nenhuma data reservada ainda, todas as datas estao LIVRES.]';
    }
  }

  const messageWithContext = incomingText + calendarContext;
  addMessage(jid, 'user', messageWithContext);

  const history = getHistory(jid);

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: buildPrompt(datetime),
      messages: history,
    });

    const reply = response.content[0]?.text?.trim();
    if (reply) addMessage(jid, 'assistant', reply);
    return reply || null;
  } catch (err) {
    console.error('[AGENT] Erro ao chamar Claude:', err.message);
    return null;
  }
}
