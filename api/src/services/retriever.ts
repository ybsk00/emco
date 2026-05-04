import { supabase } from '../lib/supabase.js';
import { embed } from '../lib/embedding.js';
import type { Category, SearchResult } from '../types/chatbot.js';

const SIMILARITY_THRESHOLD = 0.30;
const MAX_CONTEXT_DOCS = 6;
const MAX_CONTEXT_CHARS = 6000;

// 한국어 키워드 추출 — 단순 어절 분리 + 정규화 + 동의어 확장
const STOPWORDS = new Set([
  '저는', '제가', '저희', '우리', '그리고', '그런데', '하지만', '있나요', '인가요', '있어요',
  '있습니까', '있을까요', '있을지', '있는데', '있고', '하는데', '하나요', '되나요', '되어',
  '받을', '받으면', '받고', '받을까요', '주세요', '알려주세요', '뭔가요', '무엇인가요',
  '어떻게', '왜', '언제', '어디', '얼마', '얼마나', '몇', '몇번', '몇회', '입니다', '습니다',
  '같은데', '같아요', '같이', '에서', '에게', '에는', '으로', '이에요', '예요', '인데',
  '안녕', '안녕하세요',
]);

function extractKeywords(query: string): string[] {
  return Array.from(
    new Set(
      query
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && !STOPWORDS.has(s)),
    ),
  ).slice(0, 8);
}

// 도메인 동의어 (소아과)
const SYNONYMS: Record<string, string[]> = {
  '예방접종': ['접종', '백신', '주사'],
  '독감': ['플루', '인플루엔자', '독감예방접종'],
  '영유아': ['영유아검진', '아기검진', '신생아'],
  '검진': ['건강검진', '정기검진'],
  '감기': ['콧물', '기침', '인후염'],
  '발열': ['열', '고열', '미열'],
  '진료시간': ['운영시간', '오픈시간', '영업시간'],
  '주차': ['주차장', '파킹'],
  '오시는길': ['길찾기', '위치', '오시는방법'],
  '키': ['성장', '키성장', '저신장'],
  '화상': ['데임', '데었어요'],
};

function expandSynonyms(keywords: string[]): string[] {
  const out = new Set<string>(keywords);
  for (const kw of keywords) {
    const expanded = SYNONYMS[kw];
    if (expanded) expanded.forEach((s) => out.add(s));
  }
  return Array.from(out);
}

interface VectorMatchRow {
  id: string;
  question: string;
  answer: string;
  category: string;
  source_type: 'faq' | 'pubmed' | 'script';
  source_url: string | null;
  source_title: string | null;
  similarity: number;
  metadata: Record<string, unknown>;
}

async function vectorSearch(
  embedding: number[],
  k: number,
  category?: Category,
): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('emco_match_faq', {
    query_embedding: embedding as unknown as number[],
    match_threshold: SIMILARITY_THRESHOLD,
    match_count: k,
    filter_category: category ?? null,
  });
  if (error) {
    console.error('[retriever] vectorSearch error:', error);
    return [];
  }
  return ((data ?? []) as VectorMatchRow[]).map((r) => ({
    id: r.id,
    question: r.question,
    answer: r.answer,
    category: r.category,
    source_type: r.source_type,
    source_url: r.source_url,
    source_title: r.source_title,
    similarity: r.similarity,
    metadata: r.metadata,
  }));
}

async function keywordSearch(keywords: string[], k: number, category?: Category): Promise<SearchResult[]> {
  if (keywords.length === 0) return [];
  // ILIKE OR 검색 — 한국어 trigram 인덱스가 가속
  const orFilter = keywords
    .flatMap((kw) => [`question.ilike.%${kw}%`, `answer.ilike.%${kw}%`])
    .join(',');

  let q = supabase
    .from('emco_faq')
    .select('id, question, answer, category, source_type, source_url, source_title, metadata')
    .eq('is_active', true)
    .is('deleted_at', null)
    .or(orFilter)
    .limit(k);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) {
    console.error('[retriever] keywordSearch error:', error);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    question: r.question as string,
    answer: r.answer as string,
    category: r.category as string,
    source_type: r.source_type as 'faq' | 'pubmed' | 'script',
    source_url: (r.source_url as string | null) ?? null,
    source_title: (r.source_title as string | null) ?? null,
    similarity: 0.5, // 키워드 매칭 기본 점수
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  }));
}

export class EmcoRetriever {
  /** 외부에서 키워드만 필요할 때 */
  extractKeywords(query: string): string[] {
    return expandSynonyms(extractKeywords(query));
  }

  /**
   * 하이브리드 검색 (벡터 + 키워드).
   * @param category undefined 면 전 카테고리. 카테고리 필터로 결과 부족 시 무필터 fallback.
   */
  async retrieve(query: string, k = 10, category?: Category): Promise<SearchResult[]> {
    const queryVector = await embed(query);
    const keywords = expandSynonyms(extractKeywords(query));

    let [vectorResults, keywordResults] = await Promise.all([
      vectorSearch(queryVector, k * 2, category),
      keywordSearch(keywords, k, category),
    ]);

    // 카테고리 필터 결과 부족 시 전 카테고리에서 보충
    if (category && vectorResults.length + keywordResults.length < 3) {
      console.log(`[retriever] category=${category} 결과 부족, 전 카테고리 fallback`);
      const [vAll, kAll] = await Promise.all([
        vectorSearch(queryVector, k, undefined),
        keywordSearch(keywords, k, undefined),
      ]);
      vectorResults = [...vectorResults, ...vAll];
      keywordResults = [...keywordResults, ...kAll];
    }

    // merge dedup, prefer higher similarity
    const merged = new Map<string, SearchResult>();
    for (const r of vectorResults) merged.set(r.id, r);
    for (const r of keywordResults) {
      if (!merged.has(r.id)) merged.set(r.id, r);
    }

    const ranked = Array.from(merged.values()).sort((a, b) => b.similarity - a.similarity);

    // 컨텍스트 길이 제한
    const finalResults: SearchResult[] = [];
    let totalChars = 0;
    for (const doc of ranked) {
      const content = doc.answer.length + doc.question.length;
      if (finalResults.length >= MAX_CONTEXT_DOCS) break;
      if (totalChars + content > MAX_CONTEXT_CHARS) break;
      finalResults.push(doc);
      totalChars += content;
    }
    return finalResults;
  }

  /** 관련성 검사 — 가장 높은 유사도가 임계값을 넘었나 */
  static hasRelevantDocs(results: SearchResult[]): boolean {
    return results.length > 0 && results[0].similarity >= 0.45;
  }
}
