import rateLimit from 'express-rate-limit';

// 방문자 비콘 — IP당 1분에 30회 (광고차단/봇 막기보다는 폭주 방지 목적)
export const trackLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  // 비콘은 응답을 보지 않으므로 메시지 무의미하지만 일관성 위해 둠
  message: { error: 'RATE_LIMIT_EXCEEDED' },
});
