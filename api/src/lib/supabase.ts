import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// 서비스 롤 클라이언트 — RLS 우회. 백엔드 전용.
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { 'x-application-name': 'emco-chatbot-api' } },
});
