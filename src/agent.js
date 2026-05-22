// src/agent.js
// Integração com Claude API

import Anthropic from '@anthropic-ai/sdk';
import { buildPrompt } from './prompt.js';
import { getHistory, addMessage } from './memory.js';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function generateReply(jid, incomingText) {
  const datetime = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short',
  });

  // Adiciona mensagem recebida ao historico
  addMessage(jid, 'user', incomingText);

  const history = getHistory(jid);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: buildPrompt(datetime),
      messages: history,
    });

    const reply = response.content[0]?.text?.trim();

    if (reply) {
      // Adiciona resposta ao historico
      addMessage(jid, 'assistant', reply);
    }

    return reply || null;
  } catch (err) {
    console.error('[AGENT] Erro ao chamar Claude:', err.message);
    return null;
  }
}
