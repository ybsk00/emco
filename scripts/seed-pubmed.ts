/**
 * PubMed → emco_faq 시딩 (목표 5,000+개 소아과 논문 초록)
 *
 *   tsx scripts/seed-pubmed.ts                  # 기본 토픽 전체 실행
 *   tsx scripts/seed-pubmed.ts --topic vaccine  # 특정 카테고리만
 *   tsx scripts/seed-pubmed.ts --max 200        # 토픽당 최대 N개로 제한
 *
 * 환경변수:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY
 *   NCBI_API_KEY  (선택, 없으면 1초당 3req 제한 / 있으면 10req)
 *
 * 동작:
 *   - NCBI E-utilities (esearch → efetch XML) 호출
 *   - 영어 abstract 추출 → category 태깅 → Gemini text-embedding-004 임베딩
 *   - emco_faq.pmid UNIQUE 제약으로 중복 자동 skip (idempotent)
 *   - 중간 실패해도 PMID 단위 재실행 가능
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const EMBED_DIM = 768;
const EMBED_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const EMBED_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wltqkxesvtfwotcngzjj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GEMINI_KEY = process.env.GEMINI_API_KEY!;
const NCBI_KEY = process.env.NCBI_API_KEY || '';

if (!SUPABASE_KEY || !GEMINI_KEY) {
  console.error('환경변수 누락: SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Cat = 'general' | 'vaccine' | 'checkup' | 'cold' | 'emergency' | 'growth' | 'teen';

interface Topic {
  category: Cat;
  /** PubMed query — pediatric 한정자 자동 추가됨 */
  query: string;
  /** 토픽당 목표 개수 (총합 5,000+) */
  target: number;
}

const PEDIATRIC_FILTER =
  '(infant[mh] OR child[mh] OR adolescent[mh] OR pediatrics[mh] OR "child preschool"[mh])';

// 카테고리별 PubMed 쿼리 — 골고루 5,000개 이상 시딩
const TOPICS: Topic[] = [
  // vaccine — 약 1500개
  { category: 'vaccine', query: '"vaccination schedule"[tw] OR "immunization"[mh]', target: 600 },
  { category: 'vaccine', query: '"influenza vaccine"[mh] OR "MMR vaccine"[mh]', target: 400 },
  { category: 'vaccine', query: '"vaccine adverse events"[tw] OR "vaccine safety"[tw]', target: 300 },
  { category: 'vaccine', query: '"HPV vaccine"[mh] OR "rotavirus vaccine"[mh]', target: 200 },

  // cold — 약 1000개
  { category: 'cold', query: '"common cold"[mh] OR "upper respiratory infection"[tw]', target: 300 },
  { category: 'cold', query: '"influenza"[mh] AND child[mh]', target: 250 },
  { category: 'cold', query: '"COVID-19"[mh] AND ("infant"[mh] OR "child"[mh])', target: 250 },
  { category: 'cold', query: '"acute otitis media"[mh] OR "pharyngitis"[mh]', target: 200 },

  // emergency — 약 700개
  { category: 'emergency', query: '"pediatric burns"[tw] OR ("burns"[mh] AND child[mh])', target: 250 },
  { category: 'emergency', query: '"febrile seizure"[mh] OR "pediatric fever"[tw]', target: 250 },
  { category: 'emergency', query: '"pediatric anaphylaxis"[tw] OR "child poisoning"[tw]', target: 200 },

  // checkup — 약 600개
  { category: 'checkup', query: '"developmental screening"[tw] OR "child development"[mh]', target: 350 },
  { category: 'checkup', query: '"well child visit"[tw] OR "preventive pediatrics"[tw]', target: 250 },

  // growth — 약 600개
  { category: 'growth', query: '"growth hormone"[mh] AND child[mh]', target: 200 },
  { category: 'growth', query: '"short stature"[mh] OR "growth disorder"[mh]', target: 250 },
  { category: 'growth', query: '"BMI"[tw] AND ("childhood obesity"[mh] OR child[mh])', target: 150 },

  // teen — 약 500개
  { category: 'teen', query: '"precocious puberty"[mh] OR "adolescent development"[mh]', target: 250 },
  { category: 'teen', query: 'ADHD[mh] AND adolescent[mh]', target: 250 },

  // general — 약 600개 (소아과 일반)
  { category: 'general', query: '"primary pediatric care"[tw] OR "pediatric clinic"[tw]', target: 300 },
  { category: 'general', query: '"pediatric outpatient"[tw] OR "ambulatory pediatric"[tw]', target: 300 },
];

const args = process.argv.slice(2);
const onlyTopic = (() => {
  const idx = args.indexOf('--topic');
  return idx >= 0 ? (args[idx + 1] as Cat) : null;
})();
const maxPerTopic = (() => {
  const idx = args.indexOf('--max');
  return idx >= 0 ? parseInt(args[idx + 1], 10) : null;
})();

const NCBI_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const RATE_LIMIT_MS = NCBI_KEY ? 110 : 350;

let lastNcbiCall = 0;
async function rateLimitedFetch(url: string): Promise<Response> {
  const elapsed = Date.now() - lastNcbiCall;
  if (elapsed < RATE_LIMIT_MS) await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
  lastNcbiCall = Date.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NCBI ${res.status}: ${url.slice(0, 80)}`);
  return res;
}

async function searchPmids(query: string, retmax: number, retstart = 0): Promise<string[]> {
  const fullQuery = `(${query}) AND ${PEDIATRIC_FILTER} AND english[la] AND hasabstract[text]`;
  const params = new URLSearchParams({
    db: 'pubmed',
    term: fullQuery,
    retmax: retmax.toString(),
    retstart: retstart.toString(),
    retmode: 'json',
    sort: 'relevance',
  });
  if (NCBI_KEY) params.set('api_key', NCBI_KEY);
  const res = await rateLimitedFetch(`${NCBI_BASE}/esearch.fcgi?${params}`);
  const json = (await res.json()) as { esearchresult?: { idlist?: string[] } };
  return json.esearchresult?.idlist ?? [];
}

interface PubMedArticle {
  pmid: string;
  title: string;
  abstract: string;
  journal: string;
  year: string;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripTags(s: string): string {
  return decodeXmlEntities(s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

function extractField(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? stripTags(m[1]) : '';
}

function extractAbstract(xml: string): string {
  // <Abstract><AbstractText>...</AbstractText></Abstract> — 여러 섹션일 수 있음
  const abstractRoot = xml.match(/<Abstract>([\s\S]*?)<\/Abstract>/i);
  if (!abstractRoot) return '';
  const sections = [...abstractRoot[1].matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/gi)];
  return sections.map((m) => stripTags(m[1])).filter(Boolean).join(' ');
}

async function fetchArticles(pmids: string[]): Promise<PubMedArticle[]> {
  if (pmids.length === 0) return [];
  const params = new URLSearchParams({
    db: 'pubmed',
    id: pmids.join(','),
    rettype: 'abstract',
    retmode: 'xml',
  });
  if (NCBI_KEY) params.set('api_key', NCBI_KEY);
  const res = await rateLimitedFetch(`${NCBI_BASE}/efetch.fcgi?${params}`);
  const xml = await res.text();

  const articles: PubMedArticle[] = [];
  const articleBlocks = [...xml.matchAll(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g)];
  for (const block of articleBlocks) {
    const b = block[0];
    const pmid = extractField(b, 'PMID');
    const title = extractField(b, 'ArticleTitle');
    const abstract = extractAbstract(b);
    const journal = extractField(b, 'Title') || extractField(b, 'Journal');
    const year = (b.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/) || [])[1] || '';
    if (!pmid || !abstract || abstract.length < 200) continue;
    articles.push({ pmid, title, abstract, journal, year });
  }
  return articles;
}

async function alreadySeeded(pmids: string[]): Promise<Set<string>> {
  if (pmids.length === 0) return new Set();
  const { data, error } = await supabase
    .from('emco_faq')
    .select('pmid')
    .in('pmid', pmids);
  if (error) {
    console.error('[seed-pubmed] alreadySeeded query error', error);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.pmid as string));
}

async function embedText(text: string): Promise<number[] | null> {
  try {
    const trimmed = text.slice(0, 7500);
    const res = await fetch(`${EMBED_ENDPOINT}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text: trimmed }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: EMBED_DIM,
      }),
    });
    const json: any = await res.json();
    if (!res.ok || json.error) {
      console.error('[seed-pubmed] embed error:', json.error?.message || res.status);
      return null;
    }
    const values: number[] | undefined = json.embedding?.values;
    if (!values || values.length !== EMBED_DIM) {
      console.error('[seed-pubmed] embed dim mismatch:', values?.length);
      return null;
    }
    return values;
  } catch (err) {
    console.error('[seed-pubmed] embed error:', (err as Error).message);
    return null;
  }
}

async function processTopic(topic: Topic): Promise<{ inserted: number; skipped: number; failed: number }> {
  const target = maxPerTopic !== null ? Math.min(maxPerTopic, topic.target) : topic.target;
  console.log(`\n── ${topic.category} | ${topic.query.slice(0, 60)}... | 목표 ${target}개 ──`);

  // PubMed esearch (페이징)
  const allPmids: string[] = [];
  const pageSize = 200;
  for (let start = 0; allPmids.length < target * 1.4 && start < 10_000; start += pageSize) {
    const ids = await searchPmids(topic.query, pageSize, start);
    if (ids.length === 0) break;
    allPmids.push(...ids);
    if (ids.length < pageSize) break;
  }
  console.log(`  esearch → ${allPmids.length}개 PMID 후보`);

  // 이미 시딩된 PMID 제거
  const seeded = await alreadySeeded(allPmids);
  const fresh = allPmids.filter((p) => !seeded.has(p));
  console.log(`  이미 시딩된 ${seeded.size}개 제외 → 신규 ${fresh.length}개`);

  let inserted = 0;
  let skipped = seeded.size;
  let failed = 0;

  // efetch 는 batch (50개씩)
  for (let i = 0; i < fresh.length && inserted < target; i += 50) {
    const batch = fresh.slice(i, i + 50);
    const articles = await fetchArticles(batch);

    for (const a of articles) {
      if (inserted >= target) break;
      const text = `${a.title}\n\n${a.abstract}`;
      const embedding = await embedText(text);
      if (!embedding) {
        failed++;
        continue;
      }
      const sourceUrl = `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`;
      const sourceTitle = `${a.journal}${a.year ? ` (${a.year})` : ''}`.trim();

      const { error } = await supabase.from('emco_faq').insert({
        question: a.title.slice(0, 500),
        answer: a.abstract,
        category: topic.category,
        source_type: 'pubmed',
        source_url: sourceUrl,
        source_title: sourceTitle,
        pmid: a.pmid,
        language: 'en',
        embedding,
        metadata: { year: a.year, journal: a.journal },
      });
      if (error) {
        if (error.code === '23505') {
          // unique violation on pmid — race
          skipped++;
        } else {
          console.error(`[seed-pubmed] insert error pmid=${a.pmid}:`, error.message);
          failed++;
        }
        continue;
      }
      inserted++;
      if (inserted % 10 === 0) process.stdout.write(`  ✓ ${inserted}/${target}\r`);
    }
  }

  console.log(`  ${topic.category} 완료 — 추가 ${inserted}, skip ${skipped}, 실패 ${failed}`);
  return { inserted, skipped, failed };
}

async function main() {
  console.log(`PubMed 시딩 시작 (NCBI_KEY ${NCBI_KEY ? 'YES' : 'NO'}, ${RATE_LIMIT_MS}ms 간격)`);
  const topics = onlyTopic ? TOPICS.filter((t) => t.category === onlyTopic) : TOPICS;

  const totals = { inserted: 0, skipped: 0, failed: 0 };
  for (const topic of topics) {
    try {
      const r = await processTopic(topic);
      totals.inserted += r.inserted;
      totals.skipped += r.skipped;
      totals.failed += r.failed;
    } catch (err) {
      console.error(`[seed-pubmed] topic 실패:`, err);
    }
  }

  // 최종 통계
  const { count } = await supabase
    .from('emco_faq')
    .select('*', { count: 'exact', head: true })
    .eq('source_type', 'pubmed');
  console.log(`\n=== PubMed 시딩 종료 ===`);
  console.log(`이번 실행: 추가 ${totals.inserted}, skip ${totals.skipped}, 실패 ${totals.failed}`);
  console.log(`현재 DB pubmed 총: ${count ?? '?'}개`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
