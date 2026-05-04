import { env } from '../config/env.js';

// emco_faq.embedding 컬럼이 vector(768) — Matryoshka 절단으로 768 강제
const EMBED_DIM = 768;
const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

type TaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' | 'SEMANTIC_SIMILARITY';

interface EmbedResponse {
  embedding?: { values?: number[] };
  error?: { code: number; message: string; status?: string };
}

async function callEmbed(text: string, taskType: TaskType): Promise<number[]> {
  const trimmed = text.trim().slice(0, 8000);
  if (!trimmed) throw new Error('embed: empty text');

  const url = `${ENDPOINT_BASE}/${env.GEMINI_EMBEDDING_MODEL}:embedContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text: trimmed }] },
      taskType,
      outputDimensionality: EMBED_DIM,
    }),
  });
  const json = (await res.json()) as EmbedResponse;
  if (!res.ok || json.error) {
    throw new Error(`embed: ${json.error?.message || res.status} (${res.status})`);
  }
  const values = json.embedding?.values;
  if (!values || values.length !== EMBED_DIM) {
    throw new Error(`embed: bad response (dim=${values?.length})`);
  }
  return values;
}

// 문서 임베딩 (저장용)
export async function embed(text: string): Promise<number[]> {
  return callEmbed(text, 'RETRIEVAL_DOCUMENT');
}

// 쿼리 임베딩 (검색용)
export async function embedQuery(text: string): Promise<number[]> {
  return callEmbed(text, 'RETRIEVAL_QUERY');
}

// 배치 임베딩 (시딩 스크립트용 — 직렬 처리)
export async function embedBatch(texts: string[], onProgress?: (i: number, n: number) => void): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(await embed(texts[i]));
    onProgress?.(i + 1, texts.length);
    await new Promise((r) => setTimeout(r, 50));
  }
  return results;
}
