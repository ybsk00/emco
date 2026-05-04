import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';

const ai = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// Gemini text-embedding-004 — 768 차원, 다국어
export async function embed(text: string): Promise<number[]> {
  const trimmed = text.trim().slice(0, 8000);
  if (!trimmed) throw new Error('embed: empty text');

  const model = ai.getGenerativeModel({ model: env.GEMINI_EMBEDDING_MODEL });
  const result = await model.embedContent(trimmed);
  const values = result.embedding?.values;
  if (!values || values.length === 0) throw new Error('embed: no values returned');
  return values;
}

// 배치 임베딩 (시딩 스크립트용 — 직렬 처리, 단순)
export async function embedBatch(texts: string[], onProgress?: (i: number, n: number) => void): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(await embed(texts[i]));
    onProgress?.(i + 1, texts.length);
    await new Promise((r) => setTimeout(r, 50)); // soft rate limit
  }
  return results;
}
