/**
 * vitest.setup.ts — chargé via setupFiles AVANT tout module de test.
 * Définit toutes les variables d'environnement requises par env.ts
 * avant que le module soit parsé (process.env au top-level de env.ts).
 */

process.env.NODE_ENV = "test";
process.env.PORT = "3000";
process.env.ALLOWED_ORIGINS = "http://localhost:3000";
process.env.DATABASE_URL = "mysql://test:test@localhost:3306/test";
process.env.APP_ID = "test-app-id";
process.env.APP_SECRET = "test-app-secret-min-32-chars-XXXXXXXXXXXXXXXXXX";
process.env.TEACHER_SESSION_SECRET = "test-teacher-secret-min-32-chars-XXXXXXXXXX";
process.env.STUDENT_SESSION_SECRET = "test-student-secret-min-32-chars-XXXXXXXXXX";
process.env.KIMI_AUTH_URL = "https://auth.test.local";
process.env.KIMI_OPEN_URL = "https://open.test.local";
process.env.LLM_PROVIDER = "moonshot";
process.env.LLM_API_URL = "https://api.test.local/v1";
process.env.LLM_API_KEY = "test-llm-key";
process.env.LLM_MODEL = "moonshot-v1-32k";
process.env.LLM_TIMEOUT_MS = "5000";
process.env.LLM_MAX_TOKENS = "500";
process.env.LOG_LEVEL = "error";
