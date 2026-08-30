import "dotenv/config";
import { z } from "zod";

/**
 * Valeurs de repli du développement.
 *
 * Elles sont publiées dans ce dépôt : signer un cookie enseignant avec l'une
 * d'elles ne demande que de savoir lire. Elles rendent la machine de
 * développement utilisable sans configuration, et sont refusées en production
 * par `verifierSecretsDeProduction`.
 */
const SECRET_ENSEIGNANT_DEV = "dev_teacher_secret_change_in_production_at_least_32";
const SECRET_ELEVE_DEV = "dev_student_secret_change_in_production_at_least_32";

/**
 * Un secret de production ne doit ressembler à aucun de ces motifs. Un
 * déploiement qui démarre avec « change_me » est un déploiement dont les
 * sessions sont forgeables par n'importe qui.
 */
const MOTIFS_INTERDITS = [
  /^dev[_-]/i,
  /change[_-]?(me|in[_-]?production)/i,
  /^test[_-]/i,
  /^(secret|password|changeme)$/i,
];

export function verifierSecretsDeProduction(config: {
  NODE_ENV: string;
  TEACHER_SESSION_SECRET: string;
  STUDENT_SESSION_SECRET: string;
  APP_SECRET: string;
}): string[] {
  if (config.NODE_ENV !== "production") return [];

  const erreurs: string[] = [];
  const aVerifier: Array<[string, string, string | null]> = [
    ["TEACHER_SESSION_SECRET", config.TEACHER_SESSION_SECRET, SECRET_ENSEIGNANT_DEV],
    ["STUDENT_SESSION_SECRET", config.STUDENT_SESSION_SECRET, SECRET_ELEVE_DEV],
    ["APP_SECRET", config.APP_SECRET, null],
  ];

  for (const [nom, valeur, defautDev] of aVerifier) {
    if (defautDev && valeur === defautDev) {
      erreurs.push(
        `${nom} vaut encore la valeur de développement, publiée dans le dépôt : n'importe qui peut forger une session. Générez-en une avec « openssl rand -base64 48 ».`,
      );
      continue;
    }
    if (MOTIFS_INTERDITS.some((m) => m.test(valeur))) {
      erreurs.push(
        `${nom} ressemble à une valeur de remplissage (« ${valeur.slice(0, 12)}… ») : générez un secret réel avec « openssl rand -base64 48 ».`,
      );
    }
  }

  if (
    config.TEACHER_SESSION_SECRET === config.STUDENT_SESSION_SECRET ||
    config.TEACHER_SESSION_SECRET === config.APP_SECRET
  ) {
    erreurs.push(
      "Deux secrets identiques : un jeton élève pourrait passer pour un jeton enseignant. Utilisez une valeur distincte par usage.",
    );
  }

  return erreurs;
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),

  APP_ID: z.string().min(1, "APP_ID est requis"),
  APP_SECRET: z.string().min(32, "APP_SECRET doit faire au moins 32 caractères"),

  TEACHER_SESSION_SECRET: z.string().min(32, "TEACHER_SESSION_SECRET doit faire au moins 32 caractères").default(SECRET_ENSEIGNANT_DEV),
  STUDENT_SESSION_SECRET: z.string().min(32, "STUDENT_SESSION_SECRET doit faire au moins 32 caractères").default(SECRET_ELEVE_DEV),

  DATABASE_URL: z.string().min(1, "DATABASE_URL est requise"),
  /**
   * Taille du pool de connexions. Le pilote en retient dix par défaut, ce qui
   * suffit à un usage courant mais devient le point de contention quand une
   * classe entière remet sa copie dans la même seconde.
   */
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(200).default(20),
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

  // Recherche documentaire (lot D). Sans RAG_URL, le port reste débranché.
  RAG_URL: z.string().optional(),
  RAG_API_KEY: z.string().optional(),
  RAG_COLLECTION: z.string().default("default"),
  RAG_TIMEOUT_MS: z.coerce.number().default(10000),

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

  // Refus au démarrage plutôt qu'une découverte après coup : un serveur qui
  // tourne avec les secrets du dépôt accepte n'importe quel cookie forgé, et
  // rien dans son comportement ne le laisse voir.
  const fautes = verifierSecretsDeProduction(result.data);
  if (fautes.length > 0) {
    throw new Error(
      `Configuration de production refusée :\n${fautes.map((f) => `  - ${f}`).join("\n")}`,
    );
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
  dbPoolSize: _env.DB_POOL_SIZE,
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
  rag: {
    url: _env.RAG_URL,
    apiKey: _env.RAG_API_KEY,
    collection: _env.RAG_COLLECTION,
    timeoutMs: _env.RAG_TIMEOUT_MS,
  },
  allowedOrigins: _env.ALLOWED_ORIGINS.split(",").map(o => o.trim()),
  sentryDsn: _env.SENTRY_DSN,
  logLevel: _env.LOG_LEVEL,
  brandName: _env.BRAND_NAME,
  brandLogoUrl: _env.BRAND_LOGO_URL,
};
