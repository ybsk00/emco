import { getModel } from '../../lib/gemini.js';
import { INTENT_ROUTER_PROMPT } from './prompts.js';
import { formatHistory } from './utils.js';
import type { ChatTurn, Intent } from '../../types/chatbot.js';

const GREETING_PATTERN =
  /^(안녕|안뇽|hi|hello|반가워|고마워|감사|잘\s*가|잘있어|다음에|또\s*올|수고)/i;

const CONSULTATION_KEYWORDS =
  /(예약|진료\s*시간|운영\s*시간|위치|주소|길찾기|오시는\s*길|주차|전화|연락처|비용|가격|진료비|휴진|쉬는\s*날|일요일\s*진료|공휴일|토요일|점심)/;

const MEDICAL_KEYWORDS =
  /(예방\s*접종|백신|독감|감기|콧물|기침|발열|열|영유아\s*검진|발달\s*평가|키\s*성장|성장\s*곡선|화상|데었|데임|구토|설사|아토피|중이염|편도|장염|수족구|수두|홍역|볼거리|로타|폐렴|헤르페스|기저귀\s*발진|땀띠|두드러기|알레르기|코로나|RSV|성장통|초경|2차\s*성징|사춘기|행동\s*문제|adhd|자폐|언어\s*발달|틱)/i;

export function preFilterGreeting(query: string): boolean {
  const trimmed = query.trim().replace(/[.!?~ㅎㅋ\s]+$/, '');
  return trimmed.length <= 16 && GREETING_PATTERN.test(trimmed);
}

export function preFilterConsultation(query: string): boolean {
  return CONSULTATION_KEYWORDS.test(query);
}

export function preFilterMedical(query: string): boolean {
  return MEDICAL_KEYWORDS.test(query);
}

async function routeByLLM(query: string, history: ChatTurn[]): Promise<Intent> {
  const model = getModel({ temperature: 0, maxOutputTokens: 8 });
  const prompt = INTENT_ROUTER_PROMPT
    .replace('{history}', formatHistory(history, 4))
    .replace('{query}', query);
  const result = await model.generateContent(prompt);
  const answer = result.response.text().trim().toLowerCase();
  if (['greeting', 'general', 'consultation', 'medical'].includes(answer)) {
    return answer as Intent;
  }
  return 'general';
}

export async function routeIntent(query: string, history: ChatTurn[]): Promise<Intent> {
  if (preFilterGreeting(query)) return 'greeting';
  if (preFilterConsultation(query)) return 'consultation';
  if (preFilterMedical(query)) return 'medical';

  try {
    const llm = await routeByLLM(query, history);
    console.log(`[intentRouter] LLM → ${llm}`);
    return llm;
  } catch (err) {
    console.error('[intentRouter] LLM 실패, fallback:', err);
    return 'general';
  }
}
