import rateLimit from 'express-rate-limit';

// 챗봇 무거운 요청 (LLM 호출) — IP당 1분에 30회
export const aiHeavyLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMIT_EXCEEDED', message: '잠시 후 다시 시도해주세요.' },
});

// 일반 공개 — IP당 1분에 120회
export const publicLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMIT_EXCEEDED', message: '잠시 후 다시 시도해주세요.' },
});
