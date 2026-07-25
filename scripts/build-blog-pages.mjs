/**
 * lumiaeo Supabase에서 emco 콘텐츠 6건 fetch → emcokids.co.kr 디자인 토큰에 맞춘 정적 HTML 생성.
 *
 * 환경변수:
 *   LUMIAEO_SUPABASE_URL          (또는 NEXT_PUBLIC_SUPABASE_URL)
 *   LUMIAEO_SUPABASE_SERVICE_ROLE_KEY (또는 SUPABASE_SERVICE_ROLE_KEY)
 *
 * 출력:
 *   public/blog/[short-slug].html × 6
 *
 * 사용:
 *   LUMIAEO_SUPABASE_URL=... LUMIAEO_SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/build-blog-pages.mjs
 *
 * 또는 lumiaeo .env.local 자동 탐색 (../GEO시스템/lumiaeo/.env.local).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function loadEnv() {
  // 우선순위: env 이미 set > emcokids /.env.local > lumiaeo .env.local
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

const SUPABASE_URL =
  process.env.LUMIAEO_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.LUMIAEO_SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("LUMIAEO_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 필요");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
// 네이버 SERP 캐러셀 ItemList — 신규 생성 블로그 페이지에 자동 주입(2026-07-23).
const CAROUSEL_LD = (() => {
  try {
    return `<script type="application/ld+json">${JSON.stringify(JSON.parse(readFileSync("public/carousel/itemlist.json", "utf-8")))}</script>\n`;
  } catch { return ""; }
})();


/** emcokids.co.kr 짧은 slug ↔ lumiaeo 긴 slug 매핑 (sitemap·firebase.json과 동기) */
const SLUG_MAP = {
  "vaccination-schedule": "sangbong-peds-vaccination-standard-schedule-amco",
  "flu-vaccine-family": "sangbong-peds-vaccination-flu-family-pack-amco",
  "post-vaccine-fever": "sangbong-peds-vaccination-after-shot-symptoms-amco",
  "flu-rapid-test": "sangbong-peds-cold-flu-rapid-test-15min-amco",
  "well-child-checkup": "sangbong-peds-well-child-exam-compare-friendly-amco",
  "growth-curve-tips": "sangbong-peds-well-child-exam-growth-curve-tips-amco",
  "cold-flu-symptoms": "sangbong-peds-cold-flu-symptoms-amco",
  "otitis-media": "sangbong-peds-otitis-media-signs-care-amco",
  "constipation": "sangbong-peds-constipation-signs-care-amco",
  "sinusitis": "sangbong-peds-sinusitis-lingering-cold-amco",
  "precocious-puberty": "sangbong-peds-precocious-puberty-signs-amco",
  "febrile-seizure": "sangbong-peds-febrile-seizure-first-aid-amco",
  "acute-gastroenteritis": "sangbong-peds-acute-gastroenteritis-dehydration-amco",
  "swimmer-ear-otitis-externa": "sangbong-peds-swimmer-ear-otitis-externa-amco",
  "adenovirus-conjunctivitis": "sangbong-peds-adenovirus-conjunctivitis-amco",
  "urticaria-hives-care": "sangbong-peds-urticaria-hives-care-amco",
  "child-fever-antipyretics-home-care": "sangbong-peds-fever-antipyretics-home-care-amco",
  "bronchiolitis-rsv-wheezing": "sangbong-peds-bronchiolitis-rsv-wheezing-amco",
  "functional-abdominal-pain": "sangbong-peds-functional-abdominal-pain-amco",
  "bedwetting-enuresis": "sangbong-peds-bedwetting-enuresis-care-amco",
};

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

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function buildJsonLd({ shortSlug, content, brandHomeUrl }) {
  const pageUrl = `${brandHomeUrl}/blog/${shortSlug}`;
  const articleNode = {
    "@type": "BlogPosting",
    headline: content.title,
    description: content.meta_description ?? "",
    url: pageUrl,
    mainEntityOfPage: { "@type": "WebPage", "@id": pageUrl },
    datePublished: content.published_at?.slice(0, 10) ?? undefined,
    dateModified:
      (content.updated_at ?? content.published_at)?.slice(0, 10) ?? undefined,
    author: { "@type": "Person", name: "유신 원장" },
    publisher: { "@id": `${brandHomeUrl}/#clinic` },
    articleSection: content.category ?? undefined,
    inLanguage: "ko-KR",
  };
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: `${brandHomeUrl}/` },
      { "@type": "ListItem", position: 2, name: "블로그", item: `${brandHomeUrl}/#블로그` },
      { "@type": "ListItem", position: 3, name: content.title, item: pageUrl },
    ],
  };
  const faqEntries = Array.isArray(content.faq_entries) ? content.faq_entries : [];
  const faq =
    faqEntries.length > 0
      ? {
          "@type": "FAQPage",
          mainEntity: faqEntries.map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: { "@type": "Answer", text: f.answer },
          })),
        }
      : null;

  return {
    "@context": "https://schema.org",
    "@graph": [articleNode, breadcrumb, ...(faq ? [faq] : [])],
  };
}

function renderHTML({ shortSlug, content }) {
  const brandHome = "https://emcokids.co.kr";
  const pageUrl = `${brandHome}/blog/${shortSlug}`;
  const dateStr = fmtDate(content.published_at);
  const tagClass = CATEGORY_TAG_CLASS[content.category] ?? "tag-primary";
  const tagText = CATEGORY_TAG_TEXT[content.category] ?? content.category ?? "글";
  const faqEntries = Array.isArray(content.faq_entries) ? content.faq_entries : [];
  const jsonLd = buildJsonLd({ shortSlug, content, brandHomeUrl: brandHome });

  const faqHtml =
    faqEntries.length > 0
      ? `
  <section class="article-faq">
    <h2>자주 묻는 질문</h2>
    ${faqEntries
      .map(
        (f) => `
    <details class="faq-item">
      <summary>${escapeHtml(f.question)}</summary>
      <div class="faq-answer">${escapeHtml(f.answer)}</div>
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
<meta name="description" content="${escapeHtml(content.meta_description ?? "")}"/>
<meta name="robots" content="index, follow, max-image-preview:large"/>
<link rel="canonical" href="${pageUrl}"/>
<link rel="sitemap" type="application/xml" href="/sitemap.xml"/>
<link rel="alternate" type="application/rss+xml" title="엠코소아청소년과의원 블로그" href="/feed.xml"/>

<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<link rel="alternate icon" href="/favicon.ico" sizes="32x32"/>
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"/>

<meta property="og:title" content="${escapeHtml(content.title)} | 엠코소아청소년과의원"/>
<meta property="og:description" content="${escapeHtml(content.meta_description ?? "")}"/>
<meta property="og:type" content="article"/>
<meta property="og:url" content="${pageUrl}"/>
<meta property="og:locale" content="ko_KR"/>
<meta property="og:site_name" content="엠코소아청소년과의원"/>
<meta property="og:image" content="${brandHome}/og-image.png"/>
<meta property="article:published_time" content="${content.published_at ?? ""}"/>
<meta property="article:author" content="유신 원장"/>
<meta property="article:section" content="${escapeHtml(content.category ?? "")}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(content.title)}"/>
<meta name="twitter:description" content="${escapeHtml(content.meta_description ?? "")}"/>
<meta name="twitter:image" content="${brandHome}/og-image.png"/>

<meta name="geo.region" content="KR-11"/>
<meta name="geo.placename" content="서울특별시 중랑구 상봉동"/>
<meta name="geo.position" content="37.5965;127.0857"/>

<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Jua&family=Gowun+Batang:wght@400;700&family=Nanum+Pen+Script&display=swap" rel="stylesheet"/>
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css" rel="stylesheet"/>

<link rel="stylesheet" href="/styles.css"/>

<style>
.article-wrap {
  max-width: 760px;
  margin: 0 auto;
  padding: 64px 24px 96px;
  position: relative;
  z-index: 2;
}
.article-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-soft);
  font-size: 14px;
  margin-bottom: 24px;
}
.article-back:hover { color: var(--color-primary-600); }
.article-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  font-size: 14px;
  color: var(--color-text-soft);
}
.article-tag {
  font-family: 'Pretendard', sans-serif;
  font-size: 13px;
  padding: 4px 12px;
  border-radius: var(--radius-full);
  font-weight: 700;
}
.tag-primary { background: var(--color-primary-100); color: var(--color-primary-600); }
.tag-yellow  { background: var(--color-sun-200);     color: #8A6B0F; }
.tag-pink    { background: var(--color-pink-200);    color: #B5435F; }
.tag-mint    { background: var(--color-mint-200);    color: #2F7A5A; }
.tag-sky     { background: var(--color-sky-200);     color: #1E5A7F; }
.article-title {
  font-family: 'Jua', sans-serif;
  font-size: clamp(28px, 5vw, 40px);
  line-height: 1.35;
  word-break: keep-all;
  margin: 0 0 32px;
  color: var(--color-text);
}
.article-body {
  font-family: 'Pretendard', sans-serif;
  font-size: 17px;
  line-height: 1.85;
  color: var(--color-text);
}
.article-body h2 {
  font-family: 'Jua', sans-serif;
  font-size: 24px;
  line-height: 1.4;
  margin: 48px 0 16px;
  word-break: keep-all;
}
.article-body h3 {
  font-family: 'Jua', sans-serif;
  font-size: 20px;
  line-height: 1.4;
  margin: 36px 0 12px;
  color: var(--color-primary-600);
  word-break: keep-all;
}
.article-body p { margin: 0 0 20px; word-break: keep-all; }
.article-body ul, .article-body ol {
  padding-left: 1.6em;
  margin: 0 0 20px;
}
.article-body li { margin-bottom: 8px; word-break: keep-all; }
.article-body strong { font-weight: 700; color: var(--color-primary-600); }
.article-body a {
  color: var(--color-primary-600);
  border-bottom: 1px dashed var(--color-primary-300);
}
.article-body blockquote {
  border-left: 4px solid var(--color-primary-300);
  background: var(--color-primary-50);
  padding: 16px 20px;
  margin: 24px 0;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  color: var(--color-text);
}
.article-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 24px 0;
  font-size: 15px;
}
.article-body th, .article-body td {
  border: 1px solid var(--color-border);
  padding: 10px 12px;
  text-align: left;
  vertical-align: top;
}
.article-body th { background: var(--color-paper); font-weight: 700; }

.article-faq {
  margin-top: 64px;
  padding-top: 32px;
  border-top: 2px dashed var(--color-border);
}
.article-faq h2 {
  font-family: 'Jua', sans-serif;
  font-size: 26px;
  margin: 0 0 24px;
  color: var(--color-primary-600);
  word-break: keep-all;
}
.faq-item {
  background: var(--color-paper);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  margin-bottom: 12px;
}
.faq-item summary {
  font-family: 'Jua', sans-serif;
  font-size: 17px;
  cursor: pointer;
  list-style: none;
  word-break: keep-all;
}
.faq-item summary::-webkit-details-marker { display: none; }
.faq-item summary::before { content: "❓ "; }
.faq-item[open] summary::before { content: "✅ "; }
.faq-answer {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-soft);
  line-height: 1.8;
  word-break: keep-all;
}

.article-cta {
  margin-top: 72px;
  padding: 32px 24px;
  background: var(--color-primary-50);
  border-radius: var(--radius-lg);
  text-align: center;
}
.article-cta h3 {
  font-family: 'Jua', sans-serif;
  font-size: 22px;
  margin: 0 0 8px;
  color: var(--color-primary-600);
}
.article-cta p {
  margin: 0 0 20px;
  color: var(--color-text-soft);
}
.cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
}
.cta-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 12px 20px;
  border-radius: var(--radius-full);
  background: var(--color-primary-500);
  color: #fff;
  font-weight: 700;
  font-size: 15px;
  transition: transform 0.15s ease, background 0.15s ease;
}
.cta-btn:hover { background: var(--color-primary-600); transform: translateY(-1px); }
.cta-btn.outline {
  background: transparent;
  border: 2px solid var(--color-primary-500);
  color: var(--color-primary-600);
}
.cta-btn.outline:hover { background: var(--color-primary-50); }

.article-footer-nav {
  margin-top: 56px;
  padding-top: 24px;
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  color: var(--color-text-soft);
}
.article-footer-nav a:hover { color: var(--color-primary-600); }
</style>

<script type="application/ld+json">
${JSON.stringify(jsonLd, null, 1)}
</script>
${CAROUSEL_LD}</head>
<body>

<header style="padding: 16px 24px; border-bottom: 1px solid var(--color-border); background: var(--color-cream);">
  <div style="max-width: 1200px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center;">
    <a href="/" style="font-family: 'Jua', sans-serif; font-size: 18px; color: var(--color-text);">
      🏥 엠코소아청소년과의원
    </a>
    <nav style="display: flex; gap: 20px; font-size: 14px; color: var(--color-text-soft);">
      <a href="/#진료">진료</a>
      <a href="/#오시는길">오시는 길</a>
      <a href="/#블로그">블로그</a>
      <a href="tel:+82-2-433-5275" style="color: var(--color-primary-600); font-weight: 700;">📞 02-433-5275</a>
    </nav>
  </div>
</header>

<main class="article-wrap">
  <a href="/#블로그" class="article-back">← 블로그 목록으로</a>

  <div class="article-meta">
    <span class="article-tag ${tagClass}">${escapeHtml(tagText)}</span>
    ${dateStr ? `<span>${dateStr}</span>` : ""}
    <span>· 유신 원장</span>
  </div>

  <h1 class="article-title">${escapeHtml(content.title)}</h1>

  <article class="article-body">
    ${content.body_html ?? ""}
  </article>

  ${faqHtml}

  <section class="article-cta">
    <h3>아이가 아프거나 검진 받을 시기인가요?</h3>
    <p>평일 야간 20시까지, 토·일·공휴일 진료. 유신 원장님이 직접 진료합니다.</p>
    <div class="cta-row">
      <a class="cta-btn" href="tel:+82-2-433-5275">📞 전화 예약</a>
      <a class="cta-btn outline" href="/#오시는길">📍 오시는 길</a>
    </div>
  </section>

  <nav class="article-footer-nav">
    <a href="/#블로그">← 전체 블로그</a>
    <a href="/">엠코소아청소년과의원 홈 →</a>
  </nav>
</main>

<footer style="padding: 32px 24px; text-align: center; font-size: 13px; color: var(--color-text-soft); border-top: 1px solid var(--color-border); background: var(--color-paper);">
  <div>엠코소아청소년과의원 · 서울 중랑구 망우로 353 C동 308호</div>
  <div style="margin-top: 4px;">대표 유신 · 사업자등록 — · ☎ 02-433-5275</div>
</footer>

</body>
</html>
`;
}

(async () => {
  console.log("=== build-blog-pages.mjs (2026-05-19) ===\n");

  const lumiSlugs = Object.values(SLUG_MAP);
  const { data, error } = await supabase
    .from("contents")
    .select(
      "slug, title, meta_description, category, body_html, faq_entries, published_at, updated_at"
    )
    .in("slug", lumiSlugs)
    .eq("publish_status", "published");

  if (error) throw error;
  if (!data || data.length !== lumiSlugs.length) {
    console.warn(`경고: ${data?.length}/${lumiSlugs.length} fetched`);
  }

  const byLumi = new Map(data.map((d) => [d.slug, d]));
  const outDir = resolve(ROOT, "public/blog");
  mkdirSync(outDir, { recursive: true });

  for (const [shortSlug, lumiSlug] of Object.entries(SLUG_MAP)) {
    const content = byLumi.get(lumiSlug);
    if (!content) {
      console.error(`  ✗ ${shortSlug}: lumiaeo ${lumiSlug} NOT FOUND`);
      continue;
    }
    const html = renderHTML({ shortSlug, content });
    const outPath = resolve(outDir, `${shortSlug}.html`);
    writeFileSync(outPath, html, "utf-8");
    console.log(
      `  ✓ ${shortSlug}.html  (${html.length} bytes, "${content.title.slice(0, 50)}")`
    );
  }

  console.log("\n완료. firebase deploy --only hosting 으로 배포.");
})();
