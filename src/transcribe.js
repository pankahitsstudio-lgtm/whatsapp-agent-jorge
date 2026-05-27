// src/transcribe.js
// Transcreve audio usando Whisper via API da OpenAI (barato) ou fallback gracioso

import { createWriteStream, unlinkSync, existsSync } from 'fs';
import { pipeline } from 'stream/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export async function transcribeAudio(audioBuffer, mimetype = 'audio/ogg') {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    return null; // sem chave, retorna null — bot vai pedir pra mandar escrito
  }

  const ext = mimetype.includes('ogg') ? 'ogg' : 
               mimetype.includes('mp4') ? 'mp4' : 
               mimetype.includes('mpeg') ? 'mp3' : 'ogg';
  
  const tmpFile = join(tmpdir(), `audio_${Date.now()}.${ext}`);
  
  try {
    // Salva o buffer em arquivo temporario
    const { writeFileSync } = await import('fs');
    writeFileSync(tmpFile, audioBuffer);

    // Chama Whisper API
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: mimetype });
    formData.append('file', blob, `audio.${ext}`);
    formData.append('model', 'whisper-1');
    formData.append('language', 'pt');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) return null;
    
    const data = await response.json();
    return data.text?.trim() || null;
  } catch(e) {
    console.error('[WHISPER] Erro:', e.message);
    return null;
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch(e) {}
  }
}
