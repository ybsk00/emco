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
const NCBI_EMAIL = process.env.NCBI_EMAIL || '';
const NCBI_TOOL = 'emco-chatbot';

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

// ──────── 추가 batch (--batch=extra) — 가정응급/red flag/혈액검사/요검사/비만 약 2,000개 ────────
const TOPICS_EXTRA: Topic[] = [
  // 가정 응급조치 (700)
  { category: 'emergency', query: '"first aid"[mh] AND (child[mh] OR infant[mh])', target: 150 },
  { category: 'emergency', query: '"home management"[tw] AND (fever[mh] OR "acute illness"[tw]) AND child[mh]', target: 100 },
  { category: 'emergency', query: '"caregivers"[mh] AND ("emergency medical services"[mh] OR "emergencies"[mh]) AND child[mh]', target: 80 },
  { category: 'emergency', query: '"parental knowledge"[tw] AND (fever[mh] OR seizure[mh] OR "respiratory distress"[tw])', target: 80 },
  { category: 'emergency', query: '"oral rehydration therapy"[tw] AND child[mh]', target: 80 },
  { category: 'emergency', query: '"home safety"[tw] AND child[mh] AND (injury[mh] OR poisoning[mh])', target: 80 },
  { category: 'emergency', query: '"first aid education"[tw] OR "parent first aid"[tw]', target: 60 },
  { category: 'emergency', query: '"airway management"[mh] AND child[mh] AND prehospital', target: 70 },

  // Red flags / Warning signs (600)
  { category: 'emergency', query: '"red flags"[tw] AND (child[mh] OR infant[mh])', target: 100 },
  { category: 'emergency', query: '"warning signs"[tw] AND (child[mh] OR infant[mh])', target: 100 },
  { category: 'emergency', query: '"pediatric early warning score"[tw] OR "PEWS"[tw]', target: 80 },
  { category: 'emergency', query: '"pediatric emergency triage"[tw] OR "pediatric triage"[tw]', target: 80 },
  { category: 'emergency', query: '"sepsis"[mh] AND (child[mh] OR infant[mh]) AND (recognition OR signs)', target: 80 },
  { category: 'emergency', query: '"meningitis"[mh] AND (child[mh] OR infant[mh]) AND (signs OR symptoms)', target: 60 },
  { category: 'emergency', query: '"shock"[mh] AND (child[mh] OR infant[mh])', target: 50 },
  { category: 'emergency', query: '"clinical deterioration"[tw] AND (child[mh] OR infant[mh])', target: 50 },

  // 혈액검사 수치 / 영유아·소아 lab reference (350)  → checkup
  { category: 'checkup', query: '"reference values"[mh] AND (infant[mh] OR child[mh] OR neonate[mh])', target: 100 },
  { category: 'checkup', query: '"complete blood count"[mh] AND (child[mh] OR infant[mh])', target: 80 },
  { category: 'checkup', query: '"iron deficiency anemia"[mh] AND (child[mh] OR infant[mh])', target: 60 },
  { category: 'checkup', query: '("liver function tests"[mh] OR "kidney function tests"[mh]) AND child[mh]', target: 50 },
  { category: 'checkup', query: '"thyroid function tests"[mh] AND (child[mh] OR neonate[mh])', target: 30 },
  { category: 'checkup', query: '"hematologic reference values"[tw] AND child[mh]', target: 30 },

  // 요 검사 / 요뇨치 (200)  → checkup
  { category: 'checkup', query: '"urinalysis"[mh] AND (child[mh] OR infant[mh])', target: 60 },
  { category: 'checkup', query: '"urinary tract infections"[mh] AND (child[mh] OR infant[mh])', target: 60 },
  { category: 'checkup', query: '"proteinuria"[mh] AND child[mh]', target: 40 },
  { category: 'checkup', query: '"hematuria"[mh] AND child[mh]', target: 40 },

  // 비만 (400)  → growth
  { category: 'growth', query: '"pediatric obesity"[mh] OR "childhood obesity"[mh]', target: 120 },
  { category: 'growth', query: '"obesity prevention"[tw] AND (child[mh] OR adolescent[mh])', target: 80 },
  { category: 'growth', query: '"body mass index"[mh] AND (child[mh] OR adolescent[mh])', target: 60 },
  { category: 'growth', query: '"metabolic syndrome"[mh] AND (child[mh] OR adolescent[mh])', target: 60 },
  { category: 'growth', query: '"physical activity"[mh] AND ("child"[mh] OR "adolescent"[mh]) AND obesity', target: 40 },
  { category: 'growth', query: '"lifestyle modification"[tw] AND (child[mh] OR adolescent[mh]) AND obesity', target: 40 },
];

// 엠코소아과 챗봇 RAG — 가정 응급조치 + 증상별 질환 중심 (목표 5,000+개, 7 카테고리)
const TOPICS_CORE: Topic[] = [
  // ──────── vaccine — 약 800개 ────────
  { category: 'vaccine', query: '"vaccination schedule"[tw] OR "immunization schedule"[tw]', target: 200 },
  { category: 'vaccine', query: '"influenza vaccine"[mh]', target: 150 },
  { category: 'vaccine', query: '"MMR vaccine"[mh] OR "varicella vaccine"[mh]', target: 100 },
  { category: 'vaccine', query: '"vaccine adverse events"[tw] OR "vaccination safety"[tw]', target: 150 },
  { category: 'vaccine', query: '"HPV vaccine"[mh] AND adolescent[mh]', target: 60 },
  { category: 'vaccine', query: '"rotavirus vaccine"[mh] OR "pneumococcal vaccine"[mh]', target: 80 },
  { category: 'vaccine', query: '"catch up immunization"[tw] OR "missed vaccine doses"[tw]', target: 30 },
  { category: 'vaccine', query: '"simultaneous vaccination"[tw] OR "concomitant vaccines"[tw]', target: 30 },

  // ──────── cold / 호흡기 — 약 900개 ────────
  { category: 'cold', query: '"common cold"[mh] OR "upper respiratory infection"[tw]', target: 150 },
  { category: 'cold', query: '"influenza"[mh] AND (child[mh] OR infant[mh])', target: 120 },
  { category: 'cold', query: '"COVID-19"[mh] AND (child[mh] OR infant[mh])', target: 120 },
  { category: 'cold', query: '"acute otitis media"[mh]', target: 120 },
  { category: 'cold', query: '"streptococcal pharyngitis"[mh] OR "tonsillitis"[mh]', target: 100 },
  { category: 'cold', query: '"bronchiolitis"[mh] OR "RSV infection"[tw]', target: 100 },
  { category: 'cold', query: '"croup"[mh] OR "laryngitis"[mh]', target: 60 },
  { category: 'cold', query: '"asthma"[mh] AND (child[mh] OR adolescent[mh])', target: 80 },
  { category: 'cold', query: '"pediatric pneumonia"[tw] OR ("pneumonia"[mh] AND child[mh])', target: 80 },
  { category: 'cold', query: '"chronic cough"[mh] AND child[mh]', target: 30 },

  // ──────── emergency / 가정응급조치 — 약 1500개 (강화) ────────
  { category: 'emergency', query: '"pediatric burns"[tw] OR ("burns"[mh] AND child[mh])', target: 150 },
  { category: 'emergency', query: '"febrile seizure"[mh]', target: 150 },
  { category: 'emergency', query: '"pediatric fever"[tw] OR "fever management"[tw] AND child[mh]', target: 150 },
  { category: 'emergency', query: '"epistaxis"[mh] AND (child[mh] OR adolescent[mh])', target: 60 },
  { category: 'emergency', query: '"foreign body aspiration"[mh] OR "airway foreign body"[tw]', target: 100 },
  { category: 'emergency', query: '"foreign body ingestion"[tw] AND child[mh]', target: 80 },
  { category: 'emergency', query: '"pediatric head injury"[tw] OR "minor head trauma"[tw]', target: 100 },
  { category: 'emergency', query: '"pediatric lacerations"[tw] OR "wound care"[tw] AND child[mh]', target: 80 },
  { category: 'emergency', query: '"anaphylaxis"[mh] AND (child[mh] OR adolescent[mh])', target: 100 },
  { category: 'emergency', query: '"food allergy"[mh] AND (child[mh] OR infant[mh])', target: 100 },
  { category: 'emergency', query: '"choking"[mh] OR "airway obstruction"[mh] AND child[mh]', target: 60 },
  { category: 'emergency', query: '"accidental poisoning"[tw] AND child[mh]', target: 80 },
  { category: 'emergency', query: '"vomiting"[mh] AND (child[mh] OR infant[mh])', target: 80 },
  { category: 'emergency', query: '"acute gastroenteritis"[tw] AND (child[mh] OR infant[mh])', target: 100 },
  { category: 'emergency', query: '"dehydration"[mh] AND (child[mh] OR infant[mh])', target: 80 },
  { category: 'emergency', query: '"abdominal pain"[mh] AND (child[mh] OR adolescent[mh])', target: 80 },
  { category: 'emergency', query: '"intussusception"[mh] OR "pediatric appendicitis"[tw]', target: 60 },

  // ──────── 증상별 질환 (cold/emergency 외) — 약 800개 ────────
  // 발진·피부
  { category: 'cold', query: '"hand foot mouth disease"[mh]', target: 80 },
  { category: 'cold', query: '"chickenpox"[mh] OR "varicella"[mh] AND child[mh]', target: 60 },
  { category: 'cold', query: '"measles"[mh] OR "rubella"[mh] OR "roseola"[mh]', target: 60 },
  { category: 'cold', query: '"atopic dermatitis"[mh] AND (child[mh] OR infant[mh])', target: 100 },
  { category: 'cold', query: '"urticaria"[mh] AND (child[mh] OR adolescent[mh])', target: 50 },
  { category: 'cold', query: '"pediatric rash"[tw] OR "exanthema"[mh]', target: 80 },
  // 눈·귀
  { category: 'cold', query: '"conjunctivitis"[mh] AND (child[mh] OR infant[mh])', target: 50 },
  { category: 'cold', query: '"otitis externa"[mh] OR "ear pain"[tw] AND child[mh]', target: 50 },
  // 두통·복통
  { category: 'emergency', query: '"pediatric headache"[tw] OR "migraine"[mh] AND child[mh]', target: 80 },
  { category: 'emergency', query: '"chronic abdominal pain"[tw] AND child[mh]', target: 60 },
  // 영아 특이
  { category: 'emergency', query: '"infant colic"[mh] OR "diaper dermatitis"[mh]', target: 60 },
  { category: 'emergency', query: '"jaundice neonatal"[mh] OR "newborn jaundice"[tw]', target: 50 },
  { category: 'emergency', query: '"sleep disorders"[mh] AND (child[mh] OR infant[mh])', target: 50 },

  // ──────── checkup / 검진 — 약 500개 ────────
  { category: 'checkup', query: '"developmental screening"[tw] OR "child development"[mh]', target: 200 },
  { category: 'checkup', query: '"well child visit"[tw] OR "preventive pediatrics"[tw]', target: 150 },
  { category: 'checkup', query: '"developmental milestones"[tw] OR "developmental delay"[tw]', target: 150 },

  // ──────── growth / 키성장 — 약 400개 ────────
  { category: 'growth', query: '"growth hormone"[mh] AND child[mh]', target: 100 },
  { category: 'growth', query: '"short stature"[mh] OR "idiopathic short stature"[tw]', target: 100 },
  { category: 'growth', query: '"childhood obesity"[mh] OR "BMI"[tw] AND child[mh]', target: 100 },
  { category: 'growth', query: '"failure to thrive"[mh] OR "growth retardation"[tw]', target: 100 },

  // ──────── teen / 청소년 — 약 500개 ────────
  { category: 'teen', query: '"precocious puberty"[mh] OR "central precocious puberty"[tw]', target: 120 },
  { category: 'teen', query: '"adolescent development"[mh] OR "puberty"[mh]', target: 120 },
  { category: 'teen', query: 'ADHD[mh] AND (adolescent[mh] OR child[mh])', target: 150 },
  { category: 'teen', query: '"learning disorders"[mh] OR "tic disorders"[mh] AND child[mh]', target: 110 },

  // ──────── general / 소아과 일반 — 약 400개 ────────
  { category: 'general', query: '"primary pediatric care"[tw] OR "pediatric clinic"[tw]', target: 100 },
  { category: 'general', query: '"pediatric outpatient"[tw] OR "ambulatory pediatric"[tw]', target: 100 },
  { category: 'general', query: '"antibiotic stewardship"[tw] AND child[mh]', target: 100 },
  { category: 'general', query: '"pediatric medication safety"[tw] OR "pediatric prescribing"[tw]', target: 100 },
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
const batch = (() => {
  const idx = args.indexOf('--batch');
  return idx >= 0 ? args[idx + 1] : 'core';
})();
const TOPICS = batch === 'extra' ? TOPICS_EXTRA : TOPICS_CORE;

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

function ncbiCommonParams(p: URLSearchParams) {
  p.set('tool', NCBI_TOOL);
  if (NCBI_KEY) p.set('api_key', NCBI_KEY);
  if (NCBI_EMAIL) p.set('email', NCBI_EMAIL);
  return p;
}

async function searchPmids(query: string, retmax: number, retstart = 0): Promise<string[]> {
  const fullQuery = `(${query}) AND ${PEDIATRIC_FILTER} AND english[la] AND hasabstract[text]`;
  const params = ncbiCommonParams(
    new URLSearchParams({
      db: 'pubmed',
      term: fullQuery,
      retmax: retmax.toString(),
      retstart: retstart.toString(),
      retmode: 'json',
      sort: 'relevance',
    }),
  );
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
  const params = ncbiCommonParams(
    new URLSearchParams({
      db: 'pubmed',
      id: pmids.join(','),
      rettype: 'abstract',
      retmode: 'xml',
    }),
  );
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
  console.log(`PubMed 시딩 시작 (batch=${batch}, NCBI_KEY ${NCBI_KEY ? 'YES' : 'NO'}, ${RATE_LIMIT_MS}ms 간격)`);
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
