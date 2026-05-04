// 엠코소아과 챗봇 도메인 타입

export type Category =
  | 'general'    // 진료시간, 위치, 비용 등 일반 안내
  | 'vaccine'    // 예방접종
  | 'checkup'    // 영유아·청소년 검진
  | 'cold'       // 감기·독감
  | 'emergency'  // 화상·발열·응급
  | 'growth'     // 키 성장
  | 'teen';      // 청소년 진료

export type Intent = 'greeting' | 'general' | 'consultation' | 'medical';

export interface ChatTurn {
  role: 'user' | 'model';
  content: string;
}

export interface ChatRequest {
  query: string;
  history: ChatTurn[];
  requestedCategory: Category | 'auto';
}

export interface SearchResult {
  id: string;
  question: string;
  answer: string;
  category: string;
  source_type: 'faq' | 'pubmed' | 'script';
  source_url?: string | null;
  source_title?: string | null;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export interface OrchestrateResult {
  intent: Intent;
  category: Category | 'general';
  fullResponse: string;
  hadSources: boolean;
  isFallback: boolean;
  retrievedCount: number;
}
