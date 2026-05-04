import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { supabase } from '../lib/supabase.js';
import { chatbotCors } from '../middleware/cors.js';
import { aiHeavyLimiter, publicLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { EmcoOrchestrator } from '../services/orchestrator.js';
import type { Category } from '../types/chatbot.js';

const router = Router();
router.use(chatbotCors);

let orchestrator: EmcoOrchestrator | null = null;
function getOrchestrator() {
  if (!orchestrator) orchestrator = new EmcoOrchestrator();
  return orchestrator;
}

function hashIP(ip: string): string {
  return crypto.createHash('sha256').update(ip + env.IP_HASH_SALT).digest('hex').slice(0, 16);
}

// ── POST /api/patient-chatbot/chat ── 스트리밍 챗봇 응답 ───────────────────
const chatSchema = z.object({
  query: z.string().min(1).max(1000),
  category: z.enum(['auto', 'general', 'vaccine', 'checkup', 'cold', 'emergency', 'growth', 'teen']).default('auto'),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'model']),
        content: z.string().nullable().optional(),
      }),
    )
    .default([])
    .transform((arr) => arr.filter((item) => item.content && item.content.trim()) as Array<{ role: 'user' | 'model'; content: string }>),
  sessionId: z.string().uuid().nullable().optional(),
});

router.post(
  '/chat',
  aiHeavyLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    if (!env.GEMINI_API_KEY) throw new AppError(503, 'LLM_NOT_CONFIGURED', 'AI 서비스가 설정되지 않았습니다.');

    const body = chatSchema.parse(req.body);
    const { query, category: requestedCategory, history } = body;
    let sessionId = body.sessionId ?? null;

    const clientIP = req.ip || req.socket.remoteAddress || 'unknown';
    const ipHash = hashIP(clientIP);
    const userAgent = (req.headers['user-agent'] || '').slice(0, 500);

    console.log(`[/chat] q="${query.slice(0, 60)}..." cat=${requestedCategory} hist=${history.length}`);

    // 세션 생성 또는 last_seen 업데이트
    if (!sessionId) {
      const { data, error } = await supabase
        .from('emco_chat_sessions')
        .insert({ ip_hash: ipHash, user_agent: userAgent })
        .select('id')
        .single();
      if (error || !data) {
        console.error('[/chat] session create error:', error);
        throw new AppError(500, 'SESSION_CREATE_FAILED', '세션 생성 실패');
      }
      sessionId = data.id as string;
    } else {
      await supabase
        .from('emco_chat_sessions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', sessionId);
    }

    // 사용자 메시지 저장
    await supabase.from('emco_chat_messages').insert({
      session_id: sessionId,
      role: 'user',
      content: query,
    });

    // 스트리밍 헤더 — 압축·버퍼링 우회
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Session-Id', sessionId);
    res.flushHeaders();

    const startTime = Date.now();
    let intent: string | null = null;
    let category: string | null = null;
    let hadSources = false;
    let isFallback = false;
    let retrievedCount = 0;
    let fullResponse = '';

    try {
      const orch = getOrchestrator();
      const result = await orch.orchestrate(
        {
          query,
          history,
          requestedCategory: requestedCategory as Category | 'auto',
        },
        (chunk) => res.write(chunk),
      );

      intent = result.intent;
      category = result.category;
      hadSources = result.hadSources;
      isFallback = result.isFallback;
      retrievedCount = result.retrievedCount;
      fullResponse = result.fullResponse;

      // 어시스턴트 메시지 저장
      await supabase.from('emco_chat_messages').insert({
        session_id: sessionId,
        role: 'assistant',
        content: fullResponse,
        category: category && category !== 'general' ? category : null,
        metadata: { intent, hadSources, isFallback },
      });
    } catch (err) {
      console.error('[/chat] orchestrate error:', err);
      const errMsg = '죄송합니다. 잠시 후 다시 시도해 주세요. 급하시면 02-433-5275 로 전화 주세요.';
      try {
        res.write(errMsg);
      } catch {}
      fullResponse = errMsg;
      isFallback = true;
      await supabase.from('emco_chat_messages').insert({
        session_id: sessionId,
        role: 'assistant',
        content: errMsg,
        metadata: { error: true, errorMessage: (err as Error)?.message?.slice(0, 300) },
      }).then(undefined, () => undefined);
    } finally {
      const responseTime = Date.now() - startTime;
      await supabase.from('emco_chat_analytics').insert({
        session_id: sessionId,
        query,
        intent,
        category,
        response_time_ms: responseTime,
        had_sources: hadSources,
        is_fallback: isFallback,
        retrieved_count: retrievedCount,
      }).then(undefined, (e) => console.error('[/chat] analytics save:', e));

      console.log(`[/chat] intent=${intent} cat=${category} ${responseTime}ms fallback=${isFallback}`);
      res.end();
    }
  }),
);

// ── GET /api/patient-chatbot/sessions/:id/messages ── 세션 메시지 조회 ──
router.get(
  '/sessions/:id/messages',
  publicLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const id = z.string().uuid().parse(req.params.id);
    const { data, error } = await supabase
      .from('emco_chat_messages')
      .select('id, role, content, category, created_at')
      .eq('session_id', id)
      .order('created_at', { ascending: true });
    if (error) throw new AppError(500, 'DB_ERROR', '세션 조회 실패');
    res.json({ success: true, data });
  }),
);

// ── GET /api/patient-chatbot/health ──
router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

export default router;
