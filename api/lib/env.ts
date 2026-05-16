import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),

  APP_ID: z.string().min(1, "APP_ID est requis"),
  APP_SECRET: z.string().min(32, "APP_SECRET doit faire au moins 32 caractères"),

  TEACHER_SESSION_SECRET: z.string().min(32, "TEACHER_SESSION_SECRET doit faire au moins 32 caractères").default("dev_teacher_secret_change_in_production_at_least_32"),
  STUDENT_SESSION_SECRET: z.string().min(32, "STUDENT_SESSION_SECRET doit faire au moins 32 caractères").default("dev_student_secret_change_in_production_at_least_32"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL est requise"),
  REDIS_URL: z.string().optional(),

  KIMI_AUTH_URL: z.string().min(1, "KIMI_AUTH_URL est requise"),
  KIMI_OPEN_URL: z.string().min(1, "KIMI_OPEN_URL est requise"),
  KIMI_API_KEY: z.string().optional(),

  OWNER_UNION_ID: z.string().optional(),

  LLM_PROVIDER: z.string().default("moonshot"),
  LLM_API_URL: z.string().default("https://api.moonshot.cn/v1"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("moonshot-v1-32k"),
  LLM_MAX_TOKENS: z.coerce.number().default(1000),
  LLM_TIMEOUT_MS: z.coerce.number().default(30000),

  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),

  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  BRAND_NAME: z.string().default("Évaluation Mathématiques Terminale"),
  BRAND_LOGO_URL: z.string().optional(),
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map(i => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Variables d'environnement invalides :\n${issues}`);
  }
  return result.data;
}

const _env = parseEnv();

export const env = {
  appId: _env.APP_ID,
  appSecret: _env.APP_SECRET,
  teacherSessionSecret: _env.TEACHER_SESSION_SECRET,
  studentSessionSecret: _env.STUDENT_SESSION_SECRET,
  isProduction: _env.NODE_ENV === "production",
  nodeEnv: _env.NODE_ENV,
  port: _env.PORT,
  databaseUrl: _env.DATABASE_URL,
  redisUrl: _env.REDIS_URL,
  kimiAuthUrl: _env.KIMI_AUTH_URL,
  kimiOpenUrl: _env.KIMI_OPEN_URL,
  kimiApiKey: _env.KIMI_API_KEY,
  ownerUnionId: _env.OWNER_UNION_ID ?? "",
  llm: {
    provider: _env.LLM_PROVIDER,
    apiUrl: _env.LLM_API_URL,
    apiKey: _env.LLM_API_KEY,
    model: _env.LLM_MODEL,
    maxTokens: _env.LLM_MAX_TOKENS,
    timeoutMs: _env.LLM_TIMEOUT_MS,
  },
  allowedOrigins: _env.ALLOWED_ORIGINS.split(",").map(o => o.trim()),
  sentryDsn: _env.SENTRY_DSN,
  logLevel: _env.LOG_LEVEL,
  brandName: _env.BRAND_NAME,
  brandLogoUrl: _env.BRAND_LOGO_URL,
};
