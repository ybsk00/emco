import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

// Firestore 클라이언트 — Application Default Credentials (ADC) 사용.
//   - Cloud Run: 서비스 계정(903265147147-compute@…)의 메타데이터 토큰 자동 사용
//   - 로컬: `gcloud auth application-default login` 으로 받은 ADC
// 별도 service-role 키/secret 불필요 (Supabase 대비 장점).
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'emco-8a3b5';

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
}

export const db = getFirestore();
// undefined 필드는 저장 시 무시 (Supabase null 컬럼 대비 안전)
db.settings({ ignoreUndefinedProperties: true });

export { FieldValue, Timestamp };

// 컬렉션 이름 상수 (오타 방지)
export const COL = {
  faq: 'emco_faq',
  sessions: 'emco_chat_sessions',
  messages: 'emco_chat_messages',
  analytics: 'emco_chat_analytics',
  pageViews: 'emco_page_views',
} as const;

// Firestore Timestamp | Date | string → ISO 문자열
export function tsToIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  // {seconds,nanoseconds} 형태 방어
  const anyV = v as { toDate?: () => Date };
  if (typeof anyV.toDate === 'function') return anyV.toDate().toISOString();
  return null;
}
