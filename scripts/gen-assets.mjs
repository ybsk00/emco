// SVG → PNG 변환 (og-image, favicon)
//   npm run gen-assets
//
// 의존성: sharp (이미 scripts/ 가 있다면 별도 install 필요)
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, '..', 'public');

async function svg2png(srcSvg, outPng, w, h) {
  const buf = readFileSync(resolve(PUBLIC, srcSvg));
  await sharp(buf, { density: 384 })   // 고밀도 렌더 후 down
    .resize(w, h, { fit: 'cover' })
    .png({ quality: 92 })
    .toFile(resolve(PUBLIC, outPng));
  console.log(`  ✓ ${outPng}  (${w}×${h})`);
}

async function main() {
  console.log('SVG → PNG 변환 시작\n');

  await svg2png('og-image.svg', 'og-image.png', 1200, 630);
  await svg2png('og-image.svg', 'og-image-square.png', 800, 800); // 카톡 정사각 fallback

  await svg2png('favicon.svg', 'favicon-16.png', 16, 16);
  await svg2png('favicon.svg', 'favicon-32.png', 32, 32);
  await svg2png('favicon.svg', 'favicon-48.png', 48, 48);
  await svg2png('favicon.svg', 'apple-touch-icon.png', 180, 180);
  await svg2png('favicon.svg', 'android-chrome-192.png', 192, 192);
  await svg2png('favicon.svg', 'android-chrome-512.png', 512, 512);

  // .ico 는 16+32 합본 — sharp 가 ico 출력 지원 안 하므로 32×32 PNG 를 favicon.ico 명으로 저장
  // 모던 브라우저는 PNG ico 도 처리. (필요시 imagemagick 으로 별도 변환)
  await svg2png('favicon.svg', 'favicon.ico', 32, 32);

  console.log('\n완료');
}

main().catch((e) => { console.error(e); process.exit(1); });
