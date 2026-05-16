import './setup.js';

import express from 'express';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import patientChatbotRouter from './routes/patientChatbot.js';
import trackRouter from './routes/track.js';
import adminRouter from './routes/admin.js';

const app = express();

app.use(express.json({ limit: '256kb' }));
app.disable('x-powered-by');
app.set('trust proxy', 1); // Cloud Run is behind a proxy → req.ip works

// 헬스체크 (Cloud Run readiness/liveness)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'emco-chatbot-api', ts: new Date().toISOString() });
});

// API 라우트 — /api 프리픽스로 마운트 (Firebase Hosting rewrite 와 일치)
app.use('/api/patient-chatbot', patientChatbotRouter);
app.use('/api/track', trackRouter);
app.use('/api/admin', adminRouter);

// 에러 핸들러는 가장 마지막
app.use(errorHandler);

const port = env.PORT;
app.listen(port, '0.0.0.0', () => {
  console.log(`[emco-chatbot-api] listening on :${port} (${env.NODE_ENV})`);
});
