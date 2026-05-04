// 안전 가드 — 진단·처방 직접 요청 패턴 차단
const DIAGNOSIS_PATTERNS = [
  /제\s*아이\s*가?\s*.*어떤\s*병/,
  /병명\s*(?:이|을)\s*알려/,
  /무슨\s*질환/,
  /처방.*주세요/,
  /약(?:을|이)\s*뭐/,
  /약\s*(?:추천|알려)/,
  /제(?:가|게)\s*직접.*먹/,
];

export function isDiagnosisRequest(query: string): boolean {
  const trimmed = query.trim();
  return DIAGNOSIS_PATTERNS.some((p) => p.test(trimmed));
}

export const DIAGNOSIS_WARNING = [
  '죄송하지만 챗봇은 진단이나 처방을 해드릴 수 없어요.',
  '아이의 정확한 상태는 직접 진료를 통해서만 확인할 수 있답니다.',
  '증상이 걱정되시면 02-433-5275로 전화 주시거나 진료시간에 방문해 주세요.',
  '응급한 상황이라면 119 또는 가까운 응급실로 연락해 주세요. 🌷',
].join('\n');

// 응급 키워드 — 답변 끝에 119 안내 추가용
const EMERGENCY_PATTERNS =
  /(호흡곤란|숨을\s*못|숨이\s*안|의식\s*잃|쓰러|경련|발작|심한\s*출혈|입술\s*파|청색증|아나필락시스)/;

export function hasEmergencySignal(query: string): boolean {
  return EMERGENCY_PATTERNS.test(query);
}
