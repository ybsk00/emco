import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

  // DB: Firestore(ADC). 별도 URL/키 불필요. 프로젝트는 메타데이터/기본값으로 결정.
  GCLOUD_PROJECT: z.string().default('emco-8a3b5'),

  GEMINI_API_KEY: z.string().min(10),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),

  CORS_ORIGIN: z.string().default(''),
  IP_HASH_SALT: z.string().min(16).default('emco-default-salt-change-me'),

  ADMIN_USERNAME: z.string().min(1).optional(),
  ADMIN_PASSWORD: z.string().min(1).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('[env] invalid configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  corsOrigins: parsed.data.CORS_ORIGIN
    ? parsed.data.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : [],
};
