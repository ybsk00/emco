/**
 * emcokids.co.kr/blog/{slug}.html 자체 발행 글 6건 생성.
 *
 * 목적:
 *   - 자체 도메인 SEO 자산 + emco.lumiaeo.com 외부 백링크 6개 확보
 *   - lumiaeo 본문을 카피하지 않고 자체 관점으로 새로 작성 (duplicate content 방지)
 *
 * 동작:
 *   1) SEEDS 6건 각각에 대해 Gemini 2.5 Flash로 본문 JSON 생성
 *   2) 안전 가드 검사 (의료광고법 표현 / 본문 첫 줄 H1·H2 금지 / 앵커 정확 키워드 금지)
 *   3) 마지막 섹션 끝에 lumiaeo 자연 인용 1개 삽입
 *   4) HTML 빌드 → public/blog/{slug}.html 저장
 *
 * 환경변수: GEMINI_API_KEY (lumiaeo .env.local 자동 탐색)
 *
 * 사용:
 *   node scripts/seed-original-blog-posts.mjs --dry-run         # 생성만, 저장 X
 *   node scripts/seed-original-blog-posts.mjs --slug flu-vaccine-family   # 1건만
 *   node scripts/seed-original-blog-posts.mjs --all             # 6건 전부 저장
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ──────────── env 로드 ────────────
function loadEnv() {
  const candidates = [
    resolve(ROOT, ".env.local"),
    resolve(ROOT, "../GEO시스템/lumiaeo/.env.local"),
    resolve(ROOT, "../../26_03/GEO시스템/lumiaeo/.env.local"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf-8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(['"]?)(.*?)\2\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[3];
    }
  }
}
loadEnv();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 필요");

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ──────────── 시드 정의 ────────────
//
// 각 시드는 emco.lumiaeo.com의 대응 글을 1개 자연 인용 (anchor 안전 가드 적용).
// category_label: 예방접종 | 감기독감 | 검진 (build-blog-pages.mjs CATEGORY_TAG_CLASS와 동기)

const SEEDS = [
  {
    slug: "flu-vaccine-family",
    category: "예방접종",
    topic: "독감 예방접종 안전성과 가족 동시 접종",
    angle: "워킹맘 부모가 가장 자주 묻는 '아이와 부모가 같은 시기에 맞아도 되는지', '독감 백신 안전성에 대한 근거', '엠코에서의 접종 순서' 관점. NIP·임신부 무료 접종 정책 포함.",
    primary_keywords: ["독감 예방접종", "상봉동 소아과 독감", "가족 동시 접종"],
    lumiaeo_url:
      "https://emco.lumiaeo.com/blog/sangbong-peds-vaccination-flu-family-pack-amco",
    lumiaeo_anchor: "엠코소아청소년과 독감 접종 콘텐츠 허브",
  },
  {
    slug: "post-vaccine-fever",
    category: "예방접종",
    topic: "접종 후 발열·반응 대응 가이드",
    angle: "접종 당일 ~ 48시간 내 흔한 반응(미열, 부위 부기, 보챔, 식욕 저하)과 위험 반응(고열 지속, 경련, 호흡곤란) 구분. 보호자가 집에서 할 수 있는 처치 vs 야간진료·응급실 선택 기준.",
    primary_keywords: ["접종 후 발열", "예방접종 부작용", "상봉동 소아과 접종"],
    lumiaeo_url:
      "https://emco.lumiaeo.com/blog/sangbong-peds-vaccination-after-shot-symptoms-amco",
    lumiaeo_anchor: "접종 후 반응 관련 엠코 상세 자료",
  },
  {
    slug: "flu-rapid-test",
    category: "감기독감",
    topic: "독감 신속검사 15분 가이드",
    angle: "독감 신속검사가 필요한 상황(발열 24~48시간 이내, 가족 내 확진자, 등원·등교 판단), 검사 절차(코면봉·15분), 정확도 한계(음성도 임상적으로 독감일 수 있음), 검사 후 치료제 처방 흐름.",
    primary_keywords: ["독감 신속검사", "상봉동 신속검사", "독감 검사 15분"],
    lumiaeo_url:
      "https://emco.lumiaeo.com/blog/sangbong-peds-cold-flu-rapid-test-15min-amco",
    lumiaeo_anchor: "엠코소아청소년과 독감 신속검사 사례",
  },
  {
    slug: "cold-flu-symptoms",
    category: "감기독감",
    topic: "감기·독감·비염 증상 감별",
    angle: "세 질환의 발열 양상, 근육통, 콧물 색, 진행 속도, 합병증 위험 비교. 부모가 집에서 1차 판단할 때 참고할 수 있는 체크리스트. 신속검사 권장 시점과 항생제·항바이러스제 사용 원칙.",
    primary_keywords: ["감기 독감 차이", "비염 감별", "소아 호흡기 감별"],
    lumiaeo_url:
      "https://emco.lumiaeo.com/blog/sangbong-peds-cold-flu-symptoms-amco",
    lumiaeo_anchor: "엠코소아청소년과 호흡기 감별 콘텐츠",
  },
  {
    slug: "well-child-checkup",
    category: "검진",
    topic: "영유아 검진 친근 가이드",
    angle: "국가 영유아 검진 7회(생후 4·9·18·30·42·54·66개월) 일정, 각 시기의 발달 평가 항목, 검진 전 부모 준비물, 결과지 읽는 법, 발달 지연 의심 시 후속 절차. '검진이 무서운 일이 아니다' 친근 톤.",
    primary_keywords: ["영유아 검진", "상봉동 영유아 검진", "발달 검사"],
    lumiaeo_url:
      "https://emco.lumiaeo.com/blog/sangbong-peds-well-child-exam-compare-friendly-amco",
    lumiaeo_anchor: "엠코소아청소년과 발달 평가 콘텐츠 허브",
  },
  {
    slug: "growth-curve-tips",
    category: "검진",
    topic: "성장곡선 읽는 법과 키 성장 팁",
    angle: "표준 성장곡선(질병관리청 2017) 백분위 의미, '3 백분위 미만'·'97 백분위 초과' 해석, 부모가 자주 헷갈리는 점(키 평균치 vs 성장 속도), 수면·영양·운동의 실질적 영향, 성장 평가가 필요한 시점.",
    primary_keywords: ["성장곡선", "키 성장 팁", "상봉동 키 성장 평가"],
    lumiaeo_url:
      "https://emco.lumiaeo.com/blog/sangbong-peds-well-child-exam-growth-curve-tips-amco",
    lumiaeo_anchor: "엠코소아청소년과 키 성장 평가 가이드",
  },
];

// ──────────── 안전 가드 ────────────

// 의료광고법 위험 표현 (broad block — 본문에 등장 시 경고)
const RISKY_PHRASES = [
  "100%", "완벽", "완벽한", "확실한 효과", "최고의", "최상의", "유일한",
  "가장 안전한", "가장 효과적", "확실하게", "절대적", "완치", "보장",
];

// 앵커 텍스트 정확 키워드 차단 (anchor over-optimization)
const FORBIDDEN_ANCHOR_PATTERNS = [
  /상봉동\s*소아과/, /중랑구\s*소아과/, /망우동\s*소아과/,
  /독감\s*예방접종/, /영유아\s*검진/, /야간진료/,
];

function checkAnchorSafety(anchor) {
  for (const pat of FORBIDDEN_ANCHOR_PATTERNS) {
    if (pat.test(anchor)) return `정확 키워드 앵커 금지: "${anchor}" matches ${pat}`;
  }
  return null;
}

function checkBodyFirstLine(html) {
  // 첫 의미 줄이 H1/H2이면 페이지 H1 자동 출력과 중복
  const stripped = html.trim();
  if (/^\s*<h[12]\b/i.test(stripped)) {
    return "본문 첫 줄에 H1/H2 금지 (페이지 H1 자동 출력 중복)";
  }
  return null;
}

function checkRiskyPhrases(text) {
  const hits = RISKY_PHRASES.filter((p) => text.includes(p));
  if (hits.length > 0) return `의료광고법 위험 표현: ${hits.join(", ")}`;
  return null;
}

// ──────────── Gemini 호출 ────────────

const SYSTEM_PROMPT = `당신은 서울 중랑구 상봉동 동네 소아청소년과 의원(엠코소아청소년과의원, 유신 원장)의 블로그를 작성하는 의료 카피라이터입니다.

## 톤
- 부모님께 차분히 설명하는 동네 의사 톤
- 의료 정보는 임상 근거에 기반
- 광고적 과장 절대 금지 ("100%", "완벽한", "확실한 효과", "최고의" 등 사용 금지)
- "안전한" "효과적인" 같은 표현은 신중하게, 가급적 구체적 수치·조건과 함께

## 사실 (반드시 준수)
- 의원명: 엠코소아청소년과의원
- 원장: 유신 원장 (대표원장, 소아청소년과 전문의)
- 위치: 서울 중랑구 망우로 353 현대프리미어스엠코 C동 308호 (상봉동)
- 전화: 02-433-5275
- 진료시간: 월·화·목·금 10:00–20:00 (평일 야간 20시), 토·일 10:00–17:00, **수요일 정기휴무**, 점심 13:00–14:00
- 진료 항목: 감기·독감 신속검사, 예방접종, 영유아 검진, 키 성장 평가, 아토피·알레르기 진료, 청소년 검진
- 화상은 직접 진료 안 함 (베스티안·한림대 한강성심·한일병원 등 전문병원 안내)

## 구조 요구사항
- 본문 첫 줄에 H1·H2 금지 (페이지 H1이 자동 출력됨 — 중복 회피)
- 첫 문단(lead_paragraph)은 직접적인 답변 — 핵심을 첫 문장에 (AEO 패턴)
- body_sections 각 항목은 h2 + html, 본문 html에 <p>, <h3>, <ul>, <ol>, <strong>, <table> 사용 가능
- FAQ는 5개, 답변은 200~400자, 첫 문장에 직답
- 표 사용 권장 (비교·체크리스트는 표가 효과적)

## 출력 형식 (반드시 valid JSON)
{
  "title": "60자 이내 한국어 제목",
  "meta_description": "150자 이내 메타 description, 첫 문장에 핵심 요약",
  "lead_paragraph": "<p>... 한 문단, 첫 문장 직답</p>",
  "body_sections": [
    { "h2": "섹션 제목", "html": "<p>...</p><ul><li>...</li></ul>" }
  ],
  "faq": [
    { "q": "질문", "a": "답변 (200~400자, 첫 문장 직답)" }
  ]
}

JSON 외 다른 텍스트 금지. backtick·markdown code block 금지. JSON 안 백슬래시 escape 주의 (\\d, \\s, \\w 같은 정규식 escape 금지 — JSON 파서가 깨짐).`;

async function callGemini(seed) {
  const userPrompt = `다음 주제로 엠코소아청소년과의원 블로그 글 1개를 작성하세요.

주제: ${seed.topic}
관점: ${seed.angle}
주요 키워드: ${seed.primary_keywords.join(", ")}
카테고리: ${seed.category}

본문은 800~1500자 한국어. body_sections 4~6개. 표를 1개 이상 포함하면 가독성에 좋습니다.
제목은 SEO·AEO를 고려해 검색 질의와 자연스럽게 매칭되도록.

JSON으로만 답하세요.`;

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
    systemInstruction: SYSTEM_PROMPT,
  });

  const result = await model.generateContent(userPrompt);
  const text = result.response.text();
  return text;
}

function parseGeminiJson(raw) {
  // 1차: 그대로 시도
  try {
    return JSON.parse(raw);
  } catch (e1) {
    // 2차: sanitize (잘못된 backslash escape 제거)
    const sanitized = raw
      .replace(/\\(?!["\\/bfnrtu])/g, "") // \d, \s, \w 같은 잘못된 escape 제거
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    try {
      return JSON.parse(sanitized);
    } catch (e2) {
      console.error("Gemini 응답 파싱 실패. 원본 첫 500자:");
      console.error(raw.slice(0, 500));
      throw new Error(`JSON parse failed: ${e2.message}`);
    }
  }
}

// ──────────── HTML 빌더 (build-blog-pages.mjs 패턴 재사용) ────────────

const CATEGORY_TAG_CLASS = {
  예방접종: "tag-yellow",
  감기독감: "tag-pink",
  검진: "tag-mint",
};
const CATEGORY_TAG_TEXT = {
  예방접종: "예방접종",
  감기독감: "감기",
  검진: "검진",
};

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayDot() {
  return todayISO().replaceAll("-", ".");
}

function buildJsonLd({ seed, content, publishedDate }) {
  const pageUrl = `https://emcokids.co.kr/blog/${seed.slug}`;
  const articleNode = {
    "@type": ["MedicalScholarlyArticle", "Article"],
    "@id": `${pageUrl}#article`,
    headline: content.title,
    description: content.meta_description,
    url: pageUrl,
    mainEntityOfPage: { "@type": "WebPage", "@id": pageUrl },
    datePublished: publishedDate,
    dateModified: publishedDate,
    author: {
      "@type": "Person",
      name: "유신 원장",
      jobTitle: "대표원장 · 소아청소년과 전문의",
      affiliation: { "@id": "https://emcokids.co.kr/#clinic" },
    },
    publisher: { "@id": "https://emcokids.co.kr/#clinic" },
    about: seed.category,
    keywords: seed.primary_keywords.join(", "),
    image: "https://emcokids.co.kr/og-image.png",
    inLanguage: "ko-KR",
    isAccessibleForFree: true,
  };
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: "https://emcokids.co.kr/" },
      { "@type": "ListItem", position: 2, name: "블로그", item: "https://emcokids.co.kr/blog" },
      { "@type": "ListItem", position: 3, name: content.title, item: pageUrl },
    ],
  };
  const faq = {
    "@type": "FAQPage",
    mainEntity: (content.faq ?? []).map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return {
    "@context": "https://schema.org",
    "@graph": [articleNode, breadcrumb, faq],
  };
}

function renderBodyHtml(content, seed) {
  const sections = (content.body_sections ?? [])
    .map(
      (s) => `
    <h2>${escapeHtml(s.h2)}</h2>
    ${s.html ?? ""}`
    )
    .join("\n");

  // 마지막 섹션 끝에 lumiaeo 자연 인용 1개 삽입 (anchor 안전 가드 적용)
  const citation = `
    <h2>더 자세한 자료</h2>
    <p>같은 주제로 더 깊이 다룬 자료가 필요하시면 <a href="${escapeHtml(seed.lumiaeo_url)}" target="_blank" rel="noopener">${escapeHtml(seed.lumiaeo_anchor)}</a>에서 임상 근거와 사례를 정리해 두었습니다. 진료 중 자주 받는 질문을 모아 둔 페이지이니 참고로 활용해 주세요.</p>`;

  return `${content.lead_paragraph ?? ""}${sections}${citation}`;
}

function renderHTML({ seed, content, publishedDate }) {
  const pageUrl = `https://emcokids.co.kr/blog/${seed.slug}`;
  const tagClass = CATEGORY_TAG_CLASS[seed.category] ?? "tag-primary";
  const tagText = CATEGORY_TAG_TEXT[seed.category] ?? seed.category;
  const jsonLd = buildJsonLd({ seed, content, publishedDate });
  const bodyHtml = renderBodyHtml(content, seed);
  const faqHtml =
    (content.faq ?? []).length > 0
      ? `
  <section class="article-faq">
    <h2>자주 묻는 질문</h2>
    ${content.faq
      .map(
        (f) => `
    <details class="faq-item">
      <summary>${escapeHtml(f.q)}</summary>
      <div class="faq-answer">${escapeHtml(f.a)}</div>
    </details>`
      )
      .join("")}
  </section>`
      : "";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>
<meta name="theme-color" content="#FFF8F0" media="(prefers-color-scheme: light)"/>
<meta name="theme-color" content="#4A3F35" media="(prefers-color-scheme: dark)"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-title" content="엠코소아과"/>
<meta name="format-detection" content="telephone=no"/>
<title>${escapeHtml(content.title)} | 엠코소아청소년과의원</title>
<meta name="description" content="${escapeHtml(content.meta_description)}"/>
<meta name="robots" content="index, follow, max-image-preview:large"/>
<link rel="canonical" href="${pageUrl}"/>
<link rel="sitemap" type="application/xml" href="/sitemap.xml"/>
<link rel="alternate" type="application/rss+xml" title="엠코소아청소년과의원 블로그" href="/feed.xml"/>

<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<link rel="alternate icon" href="/favicon.ico" sizes="32x32"/>
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"/>

<meta property="og:title" content="${escapeHtml(content.title)} | 엠코소아청소년과의원"/>
<meta property="og:description" content="${escapeHtml(content.meta_description)}"/>
<meta property="og:type" content="article"/>
<meta property="og:url" content="${pageUrl}"/>
<meta property="og:locale" content="ko_KR"/>
<meta property="og:site_name" content="엠코소아청소년과의원"/>
<meta property="og:image" content="https://emcokids.co.kr/og-image.png"/>
<meta property="article:published_time" content="${publishedDate}"/>
<meta property="article:author" content="유신 원장"/>
<meta property="article:section" content="${escapeHtml(seed.category)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(content.title)}"/>
<meta name="twitter:description" content="${escapeHtml(content.meta_description)}"/>

<meta name="geo.region" content="KR-11"/>
<meta name="geo.placename" content="서울특별시 중랑구 상봉동"/>
<meta name="geo.position" content="37.5965;127.0857"/>

<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Jua&family=Gowun+Batang:wght@400;700&family=Nanum+Pen+Script&display=swap" rel="stylesheet"/>
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css" rel="stylesheet"/>

<link rel="stylesheet" href="/styles.css"/>

<style>
.article-wrap { max-width: 760px; margin: 0 auto; padding: 64px 24px 96px; position: relative; z-index: 2; }
.article-back { display: inline-flex; align-items: center; gap: 6px; color: var(--color-text-soft); font-size: 14px; margin-bottom: 24px; }
.article-back:hover { color: var(--color-primary-600); }
.article-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 16px; font-size: 14px; color: var(--color-text-soft); }
.article-tag { font-family: 'Pretendard', sans-serif; font-size: 13px; padding: 4px 12px; border-radius: var(--radius-full); font-weight: 700; }
.tag-primary { background: var(--color-primary-100); color: var(--color-primary-600); }
.tag-yellow  { background: var(--color-sun-200);     color: #8A6B0F; }
.tag-pink    { background: var(--color-pink-200);    color: #B5435F; }
.tag-mint    { background: var(--color-mint-200);    color: #2F7A5A; }
.tag-sky     { background: var(--color-sky-200);     color: #1E5A7F; }
.article-title { font-family: 'Jua', sans-serif; font-size: clamp(28px, 5vw, 40px); line-height: 1.35; word-break: keep-all; margin: 0 0 32px; color: var(--color-text); }
.article-body { font-family: 'Pretendard', sans-serif; font-size: 17px; line-height: 1.85; color: var(--color-text); }
.article-body h2 { font-family: 'Jua', sans-serif; font-size: 24px; line-height: 1.4; margin: 48px 0 16px; word-break: keep-all; }
.article-body h3 { font-family: 'Jua', sans-serif; font-size: 20px; line-height: 1.4; margin: 36px 0 12px; color: var(--color-primary-600); word-break: keep-all; }
.article-body p { margin: 0 0 20px; word-break: keep-all; }
.article-body ul, .article-body ol { padding-left: 1.6em; margin: 0 0 20px; }
.article-body li { margin-bottom: 8px; word-break: keep-all; }
.article-body strong { font-weight: 700; color: var(--color-primary-600); }
.article-body a { color: var(--color-primary-600); border-bottom: 1px dashed var(--color-primary-300); }
.article-body blockquote { border-left: 4px solid var(--color-primary-300); background: var(--color-primary-50); padding: 16px 20px; margin: 24px 0; border-radius: 0 var(--radius-md) var(--radius-md) 0; }
.article-body table { width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 15px; }
.article-body th, .article-body td { border: 1px solid var(--color-border); padding: 10px 12px; text-align: left; vertical-align: top; }
.article-body th { background: var(--color-paper); font-weight: 700; }
.article-faq { margin-top: 64px; padding-top: 32px; border-top: 2px dashed var(--color-border); }
.article-faq h2 { font-family: 'Jua', sans-serif; font-size: 26px; margin: 0 0 24px; color: var(--color-primary-600); word-break: keep-all; }
.faq-item { background: var(--color-paper); border-radius: var(--radius-md); padding: 16px 20px; margin-bottom: 12px; }
.faq-item summary { font-family: 'Jua', sans-serif; font-size: 17px; cursor: pointer; list-style: none; word-break: keep-all; }
.faq-item summary::-webkit-details-marker { display: none; }
.faq-item summary::before { content: "❓ "; }
.faq-item[open] summary::before { content: "✅ "; }
.faq-answer { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-border); color: var(--color-text-soft); line-height: 1.8; word-break: keep-all; }
.article-cta { margin-top: 72px; padding: 32px 24px; background: var(--color-primary-50); border-radius: var(--radius-lg); text-align: center; }
.article-cta h3 { font-family: 'Jua', sans-serif; font-size: 22px; margin: 0 0 8px; color: var(--color-primary-600); }
.article-cta p { margin: 0 0 20px; color: var(--color-text-soft); }
.cta-row { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
.cta-btn { display: inline-flex; align-items: center; gap: 6px; padding: 12px 20px; border-radius: var(--radius-full); background: var(--color-primary-500); color: #fff; font-weight: 700; font-size: 15px; transition: transform 0.15s ease, background 0.15s ease; }
.cta-btn:hover { background: var(--color-primary-600); transform: translateY(-1px); }
.cta-btn.outline { background: transparent; border: 2px solid var(--color-primary-500); color: var(--color-primary-600); }
.cta-btn.outline:hover { background: var(--color-primary-50); }
.article-footer-nav { margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; font-size: 14px; color: var(--color-text-soft); }
.article-footer-nav a:hover { color: var(--color-primary-600); }
</style>

<script type="application/ld+json">
${JSON.stringify(jsonLd, null, 1)}
</script>
</head>
<body>

<header style="padding: 16px 24px; border-bottom: 1px solid var(--color-border); background: var(--color-cream);">
  <div style="max-width: 1200px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center;">
    <a href="/" style="font-family: 'Jua', sans-serif; font-size: 18px; color: var(--color-text);">
      🏥 엠코소아청소년과의원
    </a>
    <nav style="display: flex; gap: 20px; font-size: 14px; color: var(--color-text-soft);">
      <a href="/#진료">진료</a>
      <a href="/#오시는길">오시는 길</a>
      <a href="/blog">블로그</a>
      <a href="tel:+82-2-433-5275" style="color: var(--color-primary-600); font-weight: 700;">📞 02-433-5275</a>
    </nav>
  </div>
</header>

<main class="article-wrap">
  <a href="/blog" class="article-back">← 블로그 목록으로</a>

  <div class="article-meta">
    <span class="article-tag ${tagClass}">${escapeHtml(tagText)}</span>
    <span>${todayDot()}</span>
    <span>· 유신 원장</span>
  </div>

  <h1 class="article-title">${escapeHtml(content.title)}</h1>

  <article class="article-body">
    ${bodyHtml}
  </article>

  ${faqHtml}

  <section class="article-cta">
    <h3>아이가 아프거나 검진 받을 시기인가요?</h3>
    <p>평일 야간 20시까지, 토·일 17시까지 진료. 유신 원장이 직접 진료합니다.</p>
    <div class="cta-row">
      <a class="cta-btn" href="tel:+82-2-433-5275">📞 02-433-5275 전화 예약</a>
      <a class="cta-btn outline" href="/#오시는길">📍 오시는 길</a>
    </div>
  </section>

  <nav class="article-footer-nav">
    <a href="/blog">← 전체 블로그</a>
    <a href="/">엠코소아청소년과의원 홈 →</a>
  </nav>
</main>

<footer style="padding: 32px 24px; text-align: center; font-size: 13px; color: var(--color-text-soft); border-top: 1px solid var(--color-border); background: var(--color-paper);">
  <div>엠코소아청소년과의원 · 서울 중랑구 망우로 353 C동 308호</div>
  <div style="margin-top: 4px;">대표 유신 · ☎ 02-433-5275</div>
</footer>

</body>
</html>
`;
}

// ──────────── main ────────────

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isAll = args.includes("--all");
const slugFilter = args.find((_, i) => args[i - 1] === "--slug");

if (!isDryRun && !isAll && !slugFilter) {
  console.log("사용법:");
  console.log("  --dry-run            : 모든 시드 생성 후 콘솔 출력만 (저장 X)");
  console.log("  --slug <short-slug>  : 1건만 생성 + 저장");
  console.log("  --all                : 6건 전부 생성 + 저장");
  console.log("\n사용 가능한 slug:");
  for (const s of SEEDS) console.log(`  - ${s.slug}  (${s.topic})`);
  process.exit(0);
}

const targets = slugFilter ? SEEDS.filter((s) => s.slug === slugFilter) : SEEDS;
if (targets.length === 0) {
  console.error(`slug "${slugFilter}" 를 찾을 수 없습니다.`);
  process.exit(1);
}

console.log(`=== seed-original-blog-posts.mjs ===`);
console.log(`mode: ${isDryRun ? "DRY-RUN" : isAll ? "ALL" : `SLUG=${slugFilter}`}`);
console.log(`targets: ${targets.length}건\n`);

const outDir = resolve(ROOT, "public/blog");
if (!isDryRun) mkdirSync(outDir, { recursive: true });

const publishedDate = todayISO();
const summary = [];

for (const seed of targets) {
  console.log(`\n──── ${seed.slug} ────`);
  console.log(`주제: ${seed.topic}`);

  // 앵커 안전 가드 (사전 검증)
  const anchorErr = checkAnchorSafety(seed.lumiaeo_anchor);
  if (anchorErr) {
    console.error(`  ✗ ${anchorErr}`);
    summary.push({ slug: seed.slug, status: "anchor-failed" });
    continue;
  }

  try {
    console.log("  Gemini 호출 중...");
    const raw = await callGemini(seed);
    const content = parseGeminiJson(raw);

    // 콘텐츠 안전 가드
    const fullText =
      (content.lead_paragraph ?? "") +
      " " +
      (content.body_sections ?? []).map((s) => s.html).join(" ") +
      " " +
      (content.faq ?? []).map((f) => f.a).join(" ");

    const issues = [
      checkRiskyPhrases(fullText),
      checkBodyFirstLine(content.lead_paragraph ?? ""),
      ...(content.body_sections ?? []).slice(0, 1).map((s) => checkBodyFirstLine(s.html ?? "")),
    ].filter(Boolean);

    if (issues.length > 0) {
      console.warn(`  ⚠ 경고: ${issues.join(" | ")}`);
    }

    console.log(`  제목: ${content.title}`);
    console.log(`  meta: ${(content.meta_description ?? "").slice(0, 60)}...`);
    console.log(`  섹션: ${(content.body_sections ?? []).length}개`);
    console.log(`  FAQ: ${(content.faq ?? []).length}개`);

    if (isDryRun) {
      summary.push({ slug: seed.slug, status: "dry-ok", title: content.title });
      continue;
    }

    const html = renderHTML({ seed, content, publishedDate });
    const outPath = resolve(outDir, `${seed.slug}.html`);
    writeFileSync(outPath, html, "utf-8");
    console.log(`  ✓ ${outPath} (${html.length} bytes)`);
    summary.push({ slug: seed.slug, status: "saved", title: content.title });
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    summary.push({ slug: seed.slug, status: "error", error: e.message });
  }
}

console.log("\n=== 요약 ===");
for (const s of summary) {
  console.log(`  ${s.status === "saved" || s.status === "dry-ok" ? "✓" : "✗"} ${s.slug} — ${s.status}${s.title ? ` — ${s.title}` : ""}`);
}

if (!isDryRun && summary.some((s) => s.status === "saved")) {
  console.log("\n다음 단계:");
  console.log("  1. public/blog/*.html 검수");
  console.log("  2. blog.html / index.html / sitemap.xml / feed.xml 갱신");
  console.log("  3. firebase deploy --only hosting");
}
