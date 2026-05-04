import { getModel } from '../../lib/gemini.js';
import { INTENT_ROUTER_PROMPT } from './prompts.js';
import { formatHistory } from './utils.js';
import type { ChatTurn, Intent } from '../../types/chatbot.js';

// 빌드 환경에 따라 한국어 source 가 깨지는 이슈를 우회하기 위해 모든 키워드를
// \uXXXX escape 로 하드코딩한다. JS literal 의 \u escape 는 source 인코딩과 무관하게
// 정확한 unicode codepoint 로 컴파일된다. 매칭은 String.prototype.includes() 로
// byte-exact 한 codepoint 비교를 한다 (정규식 alternation 회피).

const GREETING_KEYWORDS = [
  '안녕',                              // 안녕
  '안뇽',                              // 안뇽
  'hi', 'hello',
  '반가워',                        // 반가워
  '고마워',                        // 고마워
  '감사',                              // 감사
  '잘 가',                             // 잘 가
  '잘있어',                        // 잘있어
  '다음에',                        // 다음에
  '또 올',                             // 또 올
  '수고',                              // 수고
];

const CONSULTATION_KEYWORDS = [
  '예약',                              // 예약
  '진료시간',                  // 진료시간
  '운영시간',                  // 운영시간
  '위치',                              // 위치
  '주소',                              // 주소
  '길찾기',                        // 길찾기
  '오시는 길',                 // 오시는 길
  '주차',                              // 주차
  '전화',                              // 전화
  '연락처',                        // 연락처
  '비용',                              // 비용
  '가격',                              // 가격
  '진료비',                        // 진료비
  '휴진',                              // 휴진
  '쉬는 날',                       // 쉬는 날
  '일요일 진료',           // 일요일 진료
  '공휴일',                        // 공휴일
  '토요일',                        // 토요일
  '점심',                              // 점심
];

const MEDICAL_KEYWORDS = [
  '예방접종',                  // 예방접종
  '백신',                              // 백신
  '독감',                              // 독감
  '감기',                              // 감기
  '콧물',                              // 콧물
  '기침',                              // 기침
  '발열',                              // 발열
  '영유아 검진',           // 영유아 검진
  '발달평가',                  // 발달평가
  '키 성장',                       // 키 성장
  '성장곡선',                  // 성장곡선
  '화상',                              // 화상
  '데었',                              // 데었
  '데임',                              // 데임
  '구토',                              // 구토
  '설사',                              // 설사
  '아토피',                        // 아토피
  '중이염',                        // 중이염
  '편도',                              // 편도
  '장염',                              // 장염
  '수족구',                        // 수족구
  '수두',                              // 수두
  '홍역',                              // 홍역
  '볼거리',                        // 볼거리
  '로타',                              // 로타
  '폐렴',                              // 폐렴
  '헤르페스',                  // 헤르페스
  '기저귀 발진',           // 기저귀 발진
  '땀띠',                              // 땀띠
  '두드러기',                  // 두드러기
  '알레르기',                  // 알레르기
  '코로나',                        // 코로나
  'RSV',
  '성장통',                        // 성장통
  '초경',                              // 초경
  '2차 성징',                      // 2차 성징
  '사춘기',                        // 사춘기
  '행동 문제',                 // 행동 문제
  'adhd', 'ADHD',
  '자폐',                              // 자폐
  '언어 발달',                 // 언어 발달
  '틱',                                    // 틱
];

function containsAny(query: string, keywords: string[]): boolean {
  for (const kw of keywords) {
    if (query.includes(kw)) return true;
  }
  return false;
}

export function preFilterGreeting(query: string): boolean {
  const trimmed = query.trim().replace(/[.!?~\s]+$/, '');
  if (trimmed.length > 16) return false;
  const lower = trimmed.toLowerCase();
  for (const kw of GREETING_KEYWORDS) {
    if (lower.startsWith(kw.toLowerCase())) return true;
  }
  return false;
}

export function preFilterConsultation(query: string): boolean {
  return containsAny(query, CONSULTATION_KEYWORDS);
}

export function preFilterMedical(query: string): boolean {
  if (containsAny(query, MEDICAL_KEYWORDS)) return true;
  // 짧은 단독 키워드 '열' (열) — 토큰 경계로만 인정
  return /(^|\s)\u{C5F4}(\u{C744}|\u{C774}|\u{C5D0}|$|\s|\.|,|\?)/u.test(query);
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
    console.log(`[intentRouter] LLM => ${llm}`);
    return llm;
  } catch (err) {
    console.error('[intentRouter] LLM fallback:', err);
    return 'general';
  }
}
