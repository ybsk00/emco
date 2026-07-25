import { db, FieldValue, COL } from '../lib/firestore.js';
import { embedQuery } from '../lib/embedding.js';
import type { Category, SearchResult } from '../types/chatbot.js';

const SIMILARITY_THRESHOLD = 0.30;
const MAX_CONTEXT_DOCS = 6;
const MAX_CONTEXT_CHARS = 6000;
// 같은 카테고리 문서에 주는 소프트 가산점 (하드 필터 대신 — 복합 벡터 인덱스 회피)
const CATEGORY_BOOST = 0.03;

interface FaqDoc {
  question: string;
  answer: string;
  category: string;
  source_type: 'faq' | 'pubmed' | 'script';
  source_url: string | null;
  source_title: string | null;
  metadata: Record<string, unknown>;
  is_active?: boolean;
  deleted_at?: unknown;
}

/**
 * Firestore 벡터 검색 (findNearest, 코사인).
 * 전역 검색 후 메모리에서 필터/정렬 — flat 단일 벡터 인덱스만 필요.
 */
async function vectorSearch(embedding: number[], k: number): Promise<SearchResult[]> {
  try {
    const snap = await db
      .collection(COL.faq)
      .findNearest({
        vectorField: 'embedding',
        queryVector: FieldValue.vector(embedding),
        limit: k,
        distanceMeasure: 'COSINE',
        distanceResultField: 'vector_distance',
      })
      .get();

    const out: SearchResult[] = [];
    for (const doc of snap.docs) {
      const d = doc.data() as FaqDoc & { vector_distance?: number };
      // 비활성/삭제 문서 제외 (인덱스에 필터 미포함이므로 메모리에서 거름)
      if (d.is_active === false || d.deleted_at) continue;
      const distance = typeof d.vector_distance === 'number' ? d.vector_distance : 1;
      // 코사인 거리(0~2) → 유사도. similarity = 1 - distance
      const similarity = 1 - distance;
      out.push({
        id: doc.id,
        question: d.question,
        answer: d.answer,
        category: d.category,
        source_type: d.source_type,
        source_url: d.source_url ?? null,
        source_title: d.source_title ?? null,
        similarity,
        metadata: d.metadata ?? {},
      });
    }
    return out;
  } catch (err) {
    console.error('[retriever] vectorSearch error:', err);
    return [];
  }
}

export class EmcoRetriever {
  /**
   * 벡터 검색 (Firestore findNearest).
   * @param category 지정 시 동일 카테고리 문서에 소프트 가산점 부여(하드 필터 아님).
   */
  async retrieve(query: string, k = 10, category?: Category): Promise<SearchResult[]> {
    const queryVector = await embedQuery(query);

    let results = await vectorSearch(queryVector, Math.max(k * 2, 12));

    // 임계값 미만 제거
    results = results.filter((r) => r.similarity > SIMILARITY_THRESHOLD);

    // 카테고리 소프트 부스트 후 재정렬
    if (category) {
      results = results.map((r) =>
        r.category === category ? { ...r, similarity: r.similarity + CATEGORY_BOOST } : r,
      );
    }
    results.sort((a, b) => b.similarity - a.similarity);

    // 컨텍스트 길이 제한
    const finalResults: SearchResult[] = [];
    let totalChars = 0;
    for (const doc of results) {
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
