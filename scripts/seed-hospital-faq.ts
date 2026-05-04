/**
 * 엠코소아청소년과 운영 FAQ 시드 — 진료시간/위치/비용/접종 일정 등 핵심 정보.
 *   tsx scripts/seed-hospital-faq.ts
 * 환경변수:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const EMBED_DIM = 768;
const EMBED_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const EMBED_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wltqkxesvtfwotcngzjj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GEMINI_KEY = process.env.GEMINI_API_KEY!;

if (!SUPABASE_KEY || !GEMINI_KEY) {
  console.error('환경변수 누락: SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function embedDoc(text: string): Promise<number[] | null> {
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
    console.error('[embed] error:', json.error?.message || res.status);
    return null;
  }
  const values = json.embedding?.values;
  return values && values.length === EMBED_DIM ? values : null;
}

type Cat = 'general' | 'vaccine' | 'checkup' | 'cold' | 'emergency' | 'growth' | 'teen';

interface FaqItem {
  question: string;
  answer: string;
  category: Cat;
  tags?: string[];
}

const FAQS: FaqItem[] = [
  // ─── general (운영 정보) ───
  {
    category: 'general',
    question: '진료시간이 어떻게 되나요?',
    answer:
      '평일은 오전 10시부터 밤 21시까지 야간진료를 합니다.\n토요일·일요일·공휴일은 오전 10시부터 오후 6시까지 진료해요.\n점심시간은 매일 오후 1시~2시까지 휴진입니다.\n워킹맘·맞벌이 부부도 부담 없이 오실 수 있어요.',
    tags: ['시간', '운영'],
  },
  {
    category: 'general',
    question: '일요일에도 진료하나요?',
    answer:
      '네, 엠코소아청소년과는 일요일·공휴일에도 정상 진료합니다.\n주말·공휴일은 오전 10시부터 오후 6시까지 진료해요.\n응급실 가지 않으셔도 동네에서 든든하게 봐드릴 수 있어요. 🌷',
    tags: ['일요일', '공휴일'],
  },
  {
    category: 'general',
    question: '위치가 어디예요? 길찾기 알려주세요',
    answer:
      '서울 중랑구 망우로 353 현대프리미어스엠코 C동 308호입니다 (상봉동).\n망우역(경의중앙선)과 상봉역(7호선) 사이로, 두 역 모두 도보 5분 거리예요.\n자세한 길찾기는 카카오맵·네이버지도에서 "엠코소아청소년과의원"으로 검색해 주세요.',
    tags: ['위치', '주소', '길찾기'],
  },
  {
    category: 'general',
    question: '주차 가능한가요?',
    answer:
      '네, 현대프리미어스엠코 상가 주차장을 이용하실 수 있어요.\n진료를 받으시면 주차 도장을 도와드립니다.\n자세한 주차 시간 안내는 데스크에서 알려드려요. 🚗',
    tags: ['주차'],
  },
  {
    category: 'general',
    question: '예약은 어떻게 하나요?',
    answer:
      '예약·문의는 02-433-5275로 전화 주세요.\n바로 방문하셔서 접수하셔도 됩니다 (대기 상황은 시간대마다 다를 수 있어요).\n온라인 예약 시스템은 운영하지 않아요.',
    tags: ['예약'],
  },
  {
    category: 'general',
    question: '전화번호 알려주세요',
    answer:
      '전화 문의는 02-433-5275 입니다.\n진료시간 (평일 10~21시 / 주말·공휴일 10~18시) 내에 받습니다.\n점심시간(13~14시)은 부재중일 수 있어요.',
    tags: ['전화'],
  },
  {
    category: 'general',
    question: '점심시간 알려주세요',
    answer:
      '점심시간은 매일 오후 1시부터 2시까지 휴진합니다.\n점심시간에는 진료·전화 응대가 어려울 수 있어요. 점심시간 전후로 와주시면 안전합니다.',
    tags: ['점심'],
  },
  {
    category: 'general',
    question: '휴진일 있나요?',
    answer:
      '엠코소아청소년과는 연중무휴 운영합니다.\n일요일·공휴일에도 진료해요. 별도 휴진일이 생기는 경우는 홈페이지 또는 02-433-5275로 미리 안내드립니다.',
    tags: ['휴진'],
  },
  {
    category: 'general',
    question: '진료비는 얼마인가요?',
    answer:
      '진료비는 건강보험 적용 여부에 따라 달라집니다.\n일반 외래 진료는 건강보험 본인부담금 기준으로 청구돼요.\n비급여 항목 (일부 검사·예방접종 등)은 별도이며, 정확한 비용은 02-433-5275로 문의해 주세요.',
    tags: ['비용', '진료비'],
  },
  {
    category: 'general',
    question: '대기 시간이 긴가요?',
    answer:
      '시간대마다 다르지만, 평일 야간(18시 이후)·주말은 대기가 길 수 있어요.\n오전 시간대나 평일 14~17시가 비교적 여유로워요.\n전화로 미리 대기 상황을 여쭤보셔도 됩니다 (02-433-5275). ☺️',
    tags: ['대기'],
  },
  {
    category: 'general',
    question: '원장님은 누구신가요?',
    answer:
      '엠코소아청소년과의원의 대표 원장님은 유신 원장님이세요.\n한 분의 원장님이 평생 주치의처럼 직접 진료해 주시는 동네 소아과예요.',
    tags: ['원장', '의사'],
  },

  // ─── vaccine (예방접종) ───
  {
    category: 'vaccine',
    question: '예방접종 일정 알려주세요',
    answer:
      '국가 필수 예방접종은 출생부터 만 12세까지 정해진 일정이 있어요.\n주요 일정은 BCG (출생 직후), B형간염 (0·1·6개월), DTaP·소아마비·Hib (2·4·6개월), MMR (12~15개월) 등이에요.\n아이 개월 수를 알려주시면 다음 접종이 무엇인지 더 자세히 안내드릴 수 있어요.',
    tags: ['접종일정'],
  },
  {
    category: 'vaccine',
    question: '독감 예방접종은 언제 맞아야 하나요?',
    answer:
      '독감 예방접종은 보통 9~11월 사이가 가장 좋습니다.\n접종 후 항체가 생기는 데 약 2주가 걸리고, 효과는 6개월 정도 유지돼요.\n만 6개월 이상부터 접종 가능하며, 6개월~9세 이하는 처음이라면 4주 간격으로 2회 접종해요.',
    tags: ['독감'],
  },
  {
    category: 'vaccine',
    question: '한 번에 여러 개 맞아도 되나요?',
    answer:
      '네, 동시 접종은 안전하고 효과도 차이가 없어요.\n같은 날 여러 백신을 한 번에 맞으면 병원 방문 횟수가 줄고 일정도 따라가기 쉽답니다.\n다만 아이가 아프거나 컨디션이 좋지 않을 때는 미루는 게 좋아요.',
    tags: ['동시접종'],
  },
  {
    category: 'vaccine',
    question: '접종 후 열이 나면 어떻게 하나요?',
    answer:
      '접종 후 1~2일 정도 미열(38도 안팎)이 나는 건 흔한 반응이에요.\n해열제(아세트아미노펜·이부프로펜)로 관리하고 충분히 쉬게 해주세요.\n38.5도 이상 고열이 지속되거나 컨디션이 많이 처지면 진료 받으시는 게 안전해요.\n경련·호흡곤란 같은 증상은 즉시 119 또는 응급실로 가세요.',
    tags: ['접종후', '발열'],
  },
  {
    category: 'vaccine',
    question: '예방접종 비용 알려주세요',
    answer:
      '국가 필수 예방접종(영유아)은 보건소·지정 의료기관에서 무료로 받을 수 있어요.\n선택 접종 (수두 부스터·로타·HPV 일부 등)은 비급여이며 백신 종류에 따라 다릅니다.\n정확한 비용은 02-433-5275 로 문의해 주세요.',
    tags: ['접종비용'],
  },

  // ─── checkup (영유아·청소년 검진) ───
  {
    category: 'checkup',
    question: '영유아 검진은 몇 번 받나요?',
    answer:
      '국가 영유아 건강검진은 만 6세까지 총 8회예요 (생후 14일~71개월).\n검진은 일반진찰 + 발달평가가 함께 진행되고, 모두 무료입니다.\n검진 시기를 놓치면 일부 검사가 어렵거나 비용이 발생할 수 있어요.',
    tags: ['영유아검진'],
  },
  {
    category: 'checkup',
    question: '영유아 검진 비용은요?',
    answer:
      '국가 영유아 건강검진은 7회까지 모두 무료예요.\n발달평가·문진까지 포함되며, 보통 30~40분 정도 걸려요.\n예약 후 방문하시는 게 대기 없이 진행하기 좋아요.',
    tags: ['영유아검진'],
  },
  {
    category: 'checkup',
    question: '청소년 검진도 가능한가요?',
    answer:
      '네, 청소년 (만 7~18세) 학생 건강검진과 상담이 가능해요.\n키·체중·시력·혈압 등 기본 항목과 사춘기 성장·정서 관련 상담도 함께 진행해드려요.',
    tags: ['청소년검진'],
  },
  {
    category: 'checkup',
    question: '발달이 늦은 것 같아요. 평가받을 수 있나요?',
    answer:
      '네, 영유아 건강검진 시 K-DST 발달 선별 평가를 진행해요.\n걱정되시는 부분 (말 늦음, 또래보다 작음, 행동 문제 등)이 있으시면 미리 메모해 오시면 좋아요.\n선별 결과에 따라 추가 평가나 전문기관 의뢰를 안내드릴 수 있어요.',
    tags: ['발달평가'],
  },

  // ─── cold (감기·독감) ───
  {
    category: 'cold',
    question: '감기 신속검사 받을 수 있나요?',
    answer:
      '네, 독감·코로나 신속검사 모두 가능해요.\n결과는 약 15분 안에 확인할 수 있어요.\n증상이 시작된 지 24~48시간 안에 검사하시는 것이 정확도가 가장 높아요.',
    tags: ['신속검사'],
  },
  {
    category: 'cold',
    question: '아이 코로나 검사 가능해요?',
    answer:
      '네, 코로나 신속검사가 가능합니다.\n결과는 15분 정도 소요되고, 양성이면 격리 안내와 추가 진료 방향을 함께 알려드려요.\n증상이 있으신 경우 마스크 착용 후 방문 부탁드려요. 🌷',
    tags: ['코로나'],
  },
  {
    category: 'cold',
    question: '콧물·기침이 2주 넘게 가요',
    answer:
      '2주 이상 지속되는 콧물·기침은 감기 외 다른 원인 (알레르기, 부비동염, 천식 등)일 수 있어요.\n특히 야간 기침이 심하거나 노랗고 끈적한 콧물, 미열이 함께 있으면 진료를 받아보시는 게 좋아요.\n정확한 원인 확인 후 적절한 치료가 가능해요.',
    tags: ['장기감기'],
  },
  {
    category: 'cold',
    question: '항생제는 꼭 다 먹여야 하나요?',
    answer:
      '네, 항생제는 처방 받으신 기간 동안 끝까지 복용해주세요.\n증상이 좋아진다고 중간에 끊으면 균이 완전히 없어지지 않고 내성이 생길 수 있어요.\n다만 먹는 도중 두드러기·심한 설사·구토 등이 생기면 즉시 중단하고 연락 주세요.',
    tags: ['항생제'],
  },

  // ─── emergency (응급·화상·발열) ───
  {
    category: 'emergency',
    question: '아이가 화상을 입었어요. 어떻게 해야 하나요?',
    answer:
      '먼저 흐르는 시원한 물(20도 안팎)에 10~20분 정도 환부를 식혀주세요. 얼음이나 너무 찬물은 피해주세요.\n물집은 터뜨리지 마시고, 깨끗한 거즈로 가볍게 덮은 뒤 빨리 진료를 받으세요.\n넓은 부위(손바닥보다 큰)·얼굴·관절 부위·물집이 큰 경우는 응급실로 가시는 것이 안전해요.\n응급실 가기 전 동네에서 먼저 봐드릴 수도 있으니 02-433-5275 로 전화 주세요.',
    tags: ['화상'],
  },
  {
    category: 'emergency',
    question: '아이가 38.5도 이상 열이 나요',
    answer:
      '해열제(아세트아미노펜·이부프로펜)를 체중에 맞게 먹이고 미지근한 물수건으로 닦아주세요.\n수분을 충분히 섭취하게 하고 옷은 너무 두껍지 않게 조절하세요.\n생후 3개월 미만 아기의 38도 이상 열, 39도 이상 고열이 24시간 넘게 지속, 처짐·경련·호흡곤란이 있으면 즉시 응급실로 가세요.',
    tags: ['발열'],
  },
  {
    category: 'emergency',
    question: '아이가 경련을 일으켰어요',
    answer:
      '먼저 안전한 바닥에 옆으로 눕히고, 입에 아무것도 넣지 마세요.\n경련 시간을 재고, 5분 이상 지속되면 즉시 119에 신고하세요.\n경련이 끝난 뒤에도 의식이 돌아오지 않거나 호흡이 이상하면 바로 응급실로 가세요.\n첫 열성 경련이라면 진료를 통해 원인 확인이 꼭 필요해요.',
    tags: ['경련'],
  },

  // ─── growth (키 성장) ───
  {
    category: 'growth',
    question: '우리 아이 키가 또래보다 작아요',
    answer:
      '아이의 성장은 성장곡선 (백분위) 기준으로 평가해요.\n3퍼센타일 미만이거나, 1년에 4cm 미만으로 자라면 진료를 받아보시는 게 좋아요.\n키 성장 평가는 성장곡선·BMI·골연령 (X-ray) 등을 종합적으로 봅니다.\n정확한 평가는 진료를 통해서만 가능하니 한 번 와주세요.',
    tags: ['저신장', '성장'],
  },
  {
    category: 'growth',
    question: '키 크는 데 도움 되는 게 뭐예요?',
    answer:
      '충분한 수면(초등생 9~11시간), 균형 잡힌 영양 (단백질·칼슘·비타민D), 규칙적인 운동(점프·줄넘기 등)이 가장 중요해요.\n수면 호르몬은 밤 10~새벽 2시에 가장 많이 분비되니 일찍 자게 해주세요.\n과체중·운동 부족은 사춘기를 빠르게 해서 성장 기간을 줄일 수 있어요.',
    tags: ['키성장'],
  },

  // ─── teen (청소년) ───
  {
    category: 'teen',
    question: '아이가 사춘기에 접어든 것 같아요',
    answer:
      '여아는 보통 만 9~13세, 남아는 만 10~14세에 2차 성징이 시작돼요.\n여아 만 8세 이전 가슴 발달, 남아 만 9세 이전 고환 커짐이 보이면 성조숙증 가능성이 있어 진료가 필요해요.\n사춘기 성장 평가는 성장곡선·골연령·호르몬 검사를 함께 봅니다.',
    tags: ['사춘기'],
  },
  {
    category: 'teen',
    question: '청소년기 우울·불안 상담도 가능한가요?',
    answer:
      '신체 진료 중 정서 상태에 대한 일반 상담은 가능합니다.\n다만 본격적인 우울·불안·ADHD 등 정신과적 평가가 필요한 경우 소아청소년정신과로 연계해 드릴 수 있어요.\n부모님과 함께 와주시는 게 가장 좋아요. 🌷',
    tags: ['청소년상담'],
  },
];

async function main() {
  console.log(`[seed] ${FAQS.length}개 항목 시작 (model=${EMBED_MODEL}, dim=${EMBED_DIM})`);

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const faq of FAQS) {
    try {
      // 중복 체크 — 같은 question 이 이미 있으면 skip
      const { data: existing } = await supabase
        .from('emco_faq')
        .select('id')
        .eq('source_type', 'faq')
        .eq('question', faq.question)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      const text = `${faq.question}\n${faq.answer}`;
      const embedding = await embedDoc(text);
      if (!embedding) {
        console.error(`[seed] embed 실패: ${faq.question}`);
        failed++;
        continue;
      }

      const { error } = await supabase.from('emco_faq').insert({
        question: faq.question,
        answer: faq.answer,
        category: faq.category,
        source_type: 'faq',
        source_url: null,
        source_title: '엠코소아청소년과 안내',
        language: 'ko',
        embedding,
        metadata: { tags: faq.tags ?? [] },
      });
      if (error) {
        console.error(`[seed] insert 실패: ${faq.question}`, error);
        failed++;
        continue;
      }
      inserted++;
      process.stdout.write(`✓ ${inserted}/${FAQS.length}  ${faq.question.slice(0, 30)}...\n`);
      // soft rate limit
      await new Promise((r) => setTimeout(r, 80));
    } catch (err) {
      console.error(`[seed] 예외: ${faq.question}`, err);
      failed++;
    }
  }

  console.log(`\n[seed] 완료 — 추가 ${inserted}, 중복 skip ${skipped}, 실패 ${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
