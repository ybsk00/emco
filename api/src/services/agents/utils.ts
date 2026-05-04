import type { ChatTurn, SearchResult } from '../../types/chatbot.js';

// 마크다운 제거 — 동네 소아과 톤에 맞춰 평문으로 응답
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '· ')
    .replace(/^\d+\.\s+/gm, (m) => m); // 숫자 리스트는 유지
}

export function formatHistory(history: ChatTurn[], turns = 4): string {
  if (history.length === 0) return '없음';
  return history
    .slice(-turns)
    .map((h) => `${h.role === 'user' ? '부모님' : '코코'}: ${h.content}`)
    .join('\n');
}

export function formatRagContext(results: SearchResult[]): string {
  if (results.length === 0) return '(자료 없음)';
  return results
    .map((r, i) => {
      const head = `[자료 ${i + 1}] ${r.source_title || r.question || ''}`.trim();
      const body = r.answer.slice(0, 800);
      const src = r.source_url ? `\n출처: ${r.source_url}` : '';
      return `${head}\n${body}${src}`;
    })
    .join('\n\n---\n\n');
}

// 검색 결과 → 프론트엔드 source chip 페이로드
export function buildSourcesPayload(results: SearchResult[], max = 3) {
  return results.slice(0, max).map((r) => ({
    title: r.source_title || (r.question.length > 40 ? r.question.slice(0, 40) + '…' : r.question),
    url: r.source_url ?? null,
    sourceType: r.source_type,
    similarity: Math.round(r.similarity * 100),
  }));
}
