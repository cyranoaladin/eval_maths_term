/**
 * Fichier de setup Vitest.
 * Injecte les variables d'environnement nécessaires aux tests
 * AVANT le chargement des modules (env.ts utilise process.env au top-level).
 */

process.env.NODE_ENV = "test";
process.env.APP_ID = "test_app_id";
process.env.APP_SECRET = "test_app_secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
process.env.TEACHER_SESSION_SECRET = "test_teacher_secret_xxxxxxxxxxxxxxxxxxxxxx";
process.env.STUDENT_SESSION_SECRET = "test_student_secret_xxxxxxxxxxxxxxxxxxxxxx";
process.env.DATABASE_URL = "mysql://test:test@localhost:3306/test_db";
process.env.KIMI_AUTH_URL = "http://localhost:9999";
process.env.KIMI_OPEN_URL = "http://localhost:9998";
process.env.ALLOWED_ORIGINS = "http://localhost:3000";
process.env.LOG_LEVEL = "error";
