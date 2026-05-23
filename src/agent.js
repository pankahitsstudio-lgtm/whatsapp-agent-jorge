// src/agent.js - Integração com Claude API + verificacao de calendario

import Anthropic from '@anthropic-ai/sdk';
import { buildPrompt } from './prompt.js';
import { getHistory, addMessage } from './memory.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';
const CALENDAR_API_URL = process.env.CALENDAR_API_URL || '';

// Verifica disponibilidade no calendario antes de passar pro Claude
async function checkCalendarAvailability(text) {
  if (!CALENDAR_API_URL) return null;

  // Detecta se mensagem menciona datas (DD/MM, dia X de mes, etc)
  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})/,
    /dia\s+\d{1,2}/i,
    /\d{1,2}\s+de\s+(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/i,
    /(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/i
  ];

  const hasDate = datePatterns.some(p => p.test(text));
  if (!hasDate) return null;

  try {
    // Extrai periodo aproximado da mensagem para consultar a API
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 3, 1);
    const url = `${CALENDAR_API_URL}?start=${now.toISOString().split('T')[0]}&end=${nextMonth.toISOString().split('T')[0]}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data;
  } catch(e) {
    console.error('[CALENDAR] Erro:', e.message);
    return null;
  }
}

export async function generateReply(jid, incomingText) {
  const datetime = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short',
  });

  // Verifica calendario se necessario
  const calendarData = await checkCalendarAvailability(incomingText);
  let calendarContext = '';
  if (calendarData) {
    if (calendarData.busyDates && calendarData.busyDates.length > 0) {
      calendarContext = `\n\n[AGENDA SUITETOP - datas OCUPADAS: ${calendarData.busyDates.join(', ')}]`;
    } else {
      calendarContext = '\n\n[AGENDA SUITETOP - sem reservas no periodo consultado, datas livres]';
    }
  }

  // Monta mensagem com contexto de calendario se houver
  const messageWithContext = incomingText + calendarContext;
  addMessage(jid, 'user', messageWithContext);

  const history = getHistory(jid);

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: buildPrompt(datetime, CALENDAR_API_URL),
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
