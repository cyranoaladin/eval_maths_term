import "dotenv/config";
import { z } from "zod";

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

/**
 * En production, l'application doit connaître sa propre adresse publique.
 *
 * L'URL de redirection OAuth était construite à partir de l'en-tête `Host` de
 * la requête. Cet en-tête est fourni par le client : derrière un reverse proxy
 * mal configuré, il suffit d'en changer pour faire pointer la redirection —
 * donc le code d'autorisation — vers un domaine choisi par l'attaquant.
 * L'adresse vient désormais de la configuration, et d'elle seule.
 */
export function verifierUrlPubliqueDeProduction(config: {
  NODE_ENV: string;
  PUBLIC_BASE_URL?: string;
}): string[] {
  if (config.NODE_ENV !== "production") return [];

  const brute = config.PUBLIC_BASE_URL?.trim() ?? "";
  if (brute === "") {
    return [
      "PUBLIC_BASE_URL est requise en production : c'est l'adresse à laquelle les élèves et les enseignants joignent l'application, et la seule source de l'URL de redirection OAuth.",
    ];
  }

  let url: URL;
  try {
    url = new URL(brute);
  } catch {
    return [`PUBLIC_BASE_URL n'est pas une URL absolue : « ${brute} ».`];
  }

  const erreurs: string[] = [];
  // Exception explicite : la boucle locale. C'est ce qu'utilise la recette de
  // l'image de production, qui doit pouvoir éprouver le vrai artefact sans
  // certificat. Un cookie qui ne quitte pas la machine ne traverse rien.
  const boucleLocale = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !boucleLocale) {
    erreurs.push(
      `PUBLIC_BASE_URL doit être en https en production (reçu « ${url.protocol}//… ») : un cookie de session ne traverse pas un canal en clair.`,
    );
  }
  if (url.search !== "" || url.hash !== "") {
    erreurs.push("PUBLIC_BASE_URL ne doit porter ni paramètre ni ancre.");
  }
  return erreurs;
}

export function verifierSecretsDeProduction(config: {
  NODE_ENV: string;
  TEACHER_SESSION_SECRET: string;
  STUDENT_SESSION_SECRET: string;
  APP_SECRET: string;
}): string[] {
  if (config.NODE_ENV !== "production") return [];

  const erreurs: string[] = [];
  const aVerifier: Array<[string, string]> = [
    ["TEACHER_SESSION_SECRET", config.TEACHER_SESSION_SECRET],
    ["STUDENT_SESSION_SECRET", config.STUDENT_SESSION_SECRET],
    ["APP_SECRET", config.APP_SECRET],
  ];

  for (const [nom, valeur] of aVerifier) {
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

  /**
   * Aucune valeur de repli : un secret né dans le dépôt est un secret public.
   * `scripts/bootstrap-dev.sh` en fabrique de nouveaux, propres à la machine,
   * dans un `.env` que Git ignore.
   */
  TEACHER_SESSION_SECRET: z.string().min(32, "TEACHER_SESSION_SECRET doit faire au moins 32 caractères"),
  STUDENT_SESSION_SECRET: z.string().min(32, "STUDENT_SESSION_SECRET doit faire au moins 32 caractères"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL est requise"),
  /**
   * Taille du pool de connexions.
   *
   * Le pilote en retient dix par défaut. C'est le premier point de contention
   * quand une classe entière remet sa copie dans la même seconde : mesuré à
   * deux cents remises simultanées, le p95 passe de 3,9 s (dix connexions) à
   * 1,74 s (soixante). Au-delà, il remonte — cent quarante connexions donnent
   * 5,19 s, la base passant plus de temps à arbitrer qu'à travailler, et
   * MySQL n'en accepte de toute façon que cent cinquante et une par défaut.
   *
   * Soixante est l'optimum mesuré sur une base seule ; à ajuster si la base
   * est partagée avec d'autres applications.
   */
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(150).default(60),

  /**
   * Borne de la file d'attente du pool — le nombre de requêtes qui peuvent
   * attendre une connexion avant que le service ne réponde « saturé ».
   *
   * Zéro — l'infini du pilote — est interdit ici : « il vaut mieux attendre
   * que perdre une copie » est vrai, « donc file infinie » ne l'est pas. Une
   * saturation pathologique accumulerait des attentes sans fin et
   * transformerait une pointe en épuisement mémoire.
   *
   * Calibrée par la mesure (`scripts/mesure-file-pool.ts`), pas copiée : sur
   * deux cents remises rendues dans la même seconde — le contrat, une classe
   * entière en fin d'épreuve — la profondeur de file culmine à 140, soit
   * exactement la simultanéité moins le pool : chaque remise n'attend qu'une
   * connexion à la fois, le pic est borné par la simultanéité HTTP, pas par
   * le nombre d'allers-retours. À 400 remises — deux fois le contrat — le pic
   * mesuré est 340, 0 refus. 2 000, c'est plus de dix fois le pic du contrat :
   * aucun trafic légitime ne l'atteint, et une file pleine de 2 000 rappels
   * pèse quelques centaines de kilo-octets — bornée, donc. Au plafond, la
   * requête reçoit `503` et `Retry-After` ; la remise étant idempotente, le
   * client rejoue sans double note.
   */
  DB_QUEUE_LIMIT: z.coerce.number().int().min(1).default(2000),
  REDIS_URL: z.string().optional(),

  /**
   * Racine des dossiers de tirage papier. Hors du dépôt : les sujets imprimés
   * et les copies scannées ne sont pas du code, et le volume qui les porte est
   * sauvegardé séparément.
   */
  PAPER_OUTPUT_DIR: z.string().default("./.paper-exams"),

  KIMI_AUTH_URL: z.string().min(1, "KIMI_AUTH_URL est requise"),
  KIMI_OPEN_URL: z.string().min(1, "KIMI_OPEN_URL est requise"),
  KIMI_API_KEY: z.string().optional(),

  OWNER_UNION_ID: z.string().optional(),

  /**
   * Correction assistée. Ce fichier porte les valeurs par défaut ; ni le
   * compose ni la documentation n'en proposent d'autres — deux comportements
   * selon la façon de démarrer l'application seraient un piège.
   */
  LLM_PROVIDER: z.string().default("openrouter"),
  LLM_API_URL: z.string().default("https://openrouter.ai/api/v1"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("anthropic/claude-sonnet-5"),
  LLM_MAX_TOKENS: z.coerce.number().default(1000),
  LLM_TIMEOUT_MS: z.coerce.number().default(60000),

  // Recherche documentaire (lot D). Sans RAG_URL, le port reste débranché.
  RAG_URL: z.string().optional(),
  RAG_API_KEY: z.string().optional(),
  RAG_COLLECTION: z.string().default("default"),
  RAG_TIMEOUT_MS: z.coerce.number().default(10000),

  /**
   * Adresse publique de l'application, sans barre oblique finale.
   *
   * Requise en production : elle est la seule source de l'URL de redirection
   * OAuth. Hors production, l'adresse est déduite de la requête, ce qui rend
   * une machine de développement utilisable sans configuration.
   */
  PUBLIC_BASE_URL: z.string().optional(),

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
  const fautes = [
    ...verifierSecretsDeProduction(result.data),
    ...verifierUrlPubliqueDeProduction(result.data),
  ];
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
  dbQueueLimit: _env.DB_QUEUE_LIMIT,
  redisUrl: _env.REDIS_URL,
  paperOutputDir: _env.PAPER_OUTPUT_DIR,
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
  /** Sans barre oblique finale : les chemins sont concaténés tels quels. */
  publicBaseUrl: (_env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, ""),
  allowedOrigins: _env.ALLOWED_ORIGINS.split(",").map(o => o.trim()),
  sentryDsn: _env.SENTRY_DSN,
  logLevel: _env.LOG_LEVEL,
  brandName: _env.BRAND_NAME,
  brandLogoUrl: _env.BRAND_LOGO_URL,
};
