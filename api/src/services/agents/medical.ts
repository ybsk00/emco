import { getModel } from '../../lib/gemini.js';
import { MEDICAL_CATEGORY_PROMPT, MEDICAL_RAG_PROMPT, MEDICAL_FALLBACK_PROMPT } from './prompts.js';
import { formatHistory, formatRagContext } from './utils.js';
import type { Category, ChatTurn, SearchResult } from '../../types/chatbot.js';

const CATEGORY_KEYWORD: Array<[Category, RegExp]> = [
  ['vaccine',   /(예방\s*접종|백신|독감\s*주사|뇌수막염|폐구균|영아\s*접종|로타바이러스|hpv)/i],
  ['checkup',   /(영유아\s*검진|발달\s*평가|건강\s*검진|학생\s*검진|청소년\s*검진|발달\s*선별)/],
  ['cold',      /(감기|독감|콧물|기침|인후염|편도|중이염|신속\s*검사|코로나)/],
  ['emergency', /(화상|데었|데임|발열|고열|경련|호흡\s*곤란|쓰러|아나필락시스|심한\s*출혈|119)/],
  ['growth',    /(키\s*성장|성장\s*곡선|골\s*연령|저신장|성장통|성장\s*호르몬)/],
  ['teen',      /(사춘기|초경|2차\s*성징|틱|adhd|학습\s*문제|언어\s*발달)/i],
];

// 빠른 키워드 우선 — LLM 호출 없이 즉시 분류 가능하면 그 결과 사용
export function classifyMedicalCategoryByKeyword(query: string): Category | null {
  for (const [cat, re] of CATEGORY_KEYWORD) {
    if (re.test(query)) return cat;
  }
  return null;
}

export async function classifyMedicalCategory(
  query: string,
  history: ChatTurn[],
): Promise<Category> {
  const fast = classifyMedicalCategoryByKeyword(query);
  if (fast) return fast;

  try {
    const model = getModel({ temperature: 0, maxOutputTokens: 8 });
    const prompt = MEDICAL_CATEGORY_PROMPT
      .replace('{history}', formatHistory(history, 3))
      .replace('{query}', query);
    const result = await model.generateContent(prompt);
    const answer = result.response.text().trim().toLowerCase() as Category;
    const allowed: Category[] = ['vaccine', 'checkup', 'cold', 'emergency', 'growth', 'teen', 'general'];
    return allowed.includes(answer) ? answer : 'general';
  } catch (err) {
    console.error('[medical] classify 실패, general fallback:', err);
    return 'general';
  }
}

export async function* generateMedicalRagResponse(
  query: string,
  history: ChatTurn[],
  ragContext: SearchResult[],
): AsyncGenerator<string, void, unknown> {
  const model = getModel({ temperature: 0.4, maxOutputTokens: 1024 });
  const prompt = MEDICAL_RAG_PROMPT
    .replace('{context}', formatRagContext(ragContext))
    .replace('{history}', formatHistory(history, 4))
    .replace('{query}', query);

  const result = await model.generateContentStream(prompt);
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

export async function* generateMedicalFallbackResponse(
  query: string,
  history: ChatTurn[],
): AsyncGenerator<string, void, unknown> {
  const model = getModel({ temperature: 0.3, maxOutputTokens: 768 });
  const prompt = MEDICAL_FALLBACK_PROMPT
    .replace('{history}', formatHistory(history, 4))
    .replace('{query}', query);

  const result = await model.generateContentStream(prompt);
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}
