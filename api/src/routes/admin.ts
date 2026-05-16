import { Router, type Request, type Response } from 'express';
import { supabase } from '../lib/supabase.js';
import { basicAuth } from '../middleware/basicAuth.js';
import { publicLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = Router();

// 모든 어드민 엔드포인트는 Basic Auth + 일반 rate limit
router.use(basicAuth);
router.use(publicLimiter);

// 캐시 금지 (Cloud Run/CDN/브라우저 모두)
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// GET /api/admin/stats — 전체 대시보드 집계
router.get(
  '/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    const { data, error } = await supabase.rpc('emco_admin_stats');
    if (error) {
      console.error('[admin/stats] rpc error:', error);
      throw new AppError(500, 'STATS_FAILED', '통계 조회 실패');
    }
    res.json(data ?? {});
  }),
);

export default router;
