// 인사 에이전트 — LLM 호출 없이 하드코딩 (응답 즉시)

const REPLIES = [
  '안녕하세요 부모님! 저는 엠코소아청소년과의 챗봇 코코예요 🐻\n진료시간, 예방접종, 검진 일정… 무엇이든 편하게 물어봐 주세요.',
  '안녕하세요! 와주셔서 반가워요 🌷\n오늘은 어떤 게 궁금하신가요? 진료시간·예방접종·증상 상담 모두 도와드릴 수 있어요.',
  '안녕하세요 보호자님! 코코예요.\n급한 일이시면 02-433-5275 로 바로 전화 주셔도 좋고, 여기서 편하게 물어봐 주셔도 돼요 ☺️',
];

const FAREWELL_PATTERNS = /(잘\s*가|다음에|또\s*올|수고|고마|감사)/;

export function generateGreetingResponse(query: string): string {
  if (FAREWELL_PATTERNS.test(query)) {
    return '오늘도 와주셔서 감사해요! 아이와 부모님 모두 건강한 하루 보내세요 🌷\n또 궁금한 게 생기면 언제든 들러주세요.';
  }
  // 안정적 응답을 위해 첫 번째 reply 를 기본으로, history 기반 분기 없음.
  return REPLIES[0];
}
