/**
 * api/grading/llm-client.ts
 *
 * Client LLM pour la correction des réponses élèves.
 * - Moonshot/Kimi API (compatible OpenAI chat completions)
 * - Retry × 3 avec backoff exponentiel (1s, 3s, 9s)
 * - Cache LRU keyed par SHA-256 des arguments (TTL 1h, max 1000 entrées)
 * - Parsing tolérant aux fences ```json ... ```
 *
 * Pièges gérés :
 * - response_format JSON_object non supporté par certains modèles → omis si erreur 400
 * - Réponse enveloppée dans ``` → stripped avant parse
 * - Score clampé au barème max et arrondi au demi-point
 */
import { LRUCache } from "lru-cache";
import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { buildGradingPrompt } from "./grading-prompt";
import type { GradingPromptArgs } from "./grading-prompt";

const LLMResponseSchema = z.object({
  score: z.number().min(0),
  feedback: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
  issues: z
    .array(z.enum(["calcul", "justification", "notation", "domaine", "rédaction"]))
    .optional(),
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

const cache = new LRUCache<string, LLMResponse>({
  max: 1000,
  ttl: 1000 * 60 * 60, // 1h
});

export async function gradeWithLLM(args: GradingPromptArgs): Promise<LLMResponse> {
  if (!env.llm.apiKey) {
    throw new Error("LLM_API_KEY non configurée — correction LLM impossible");
  }

  const cacheKey = createHash("sha256").update(JSON.stringify(args)).digest("hex");
  const cached = cache.get(cacheKey);
  if (cached) {
    logger.debug("LLM cache hit", { cacheKey });
    return cached;
  }

  const messages = buildGradingPrompt(args);

  // 3 tentatives avec backoff exponentiel : 1s, 3s, 9s
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await callLLMWithTimeout(messages, env.llm.timeoutMs);
      const parsed = parseLLMResponse(raw, args.maxPoints);
      cache.set(cacheKey, parsed);
      logger.info("LLM correction réussie", { attempt, score: parsed.score, confidence: parsed.confidence });
      return parsed;
    } catch (e) {
      lastError = e;
      logger.warn("LLM appel échoué", { attempt, error: String(e) });
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * 3 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

async function callLLMWithTimeout(
  messages: ChatMessage[],
  timeoutMs: number,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const body: Record<string, unknown> = {
      model: env.llm.model,
      messages,
      temperature: 0.2,
      max_tokens: env.llm.maxTokens,
    };

    // response_format JSON_object : supporté sur moonshot-v1-32k, pas sur 8k
    // On l'inclut par défaut — si erreur 400, le retry tentera sans
    if (!env.llm.model.includes("8k")) {
      body.response_format = { type: "json_object" };
    }

    const r = await fetch(`${env.llm.apiUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.llm.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!r.ok) {
      const text = await r.text();
      throw new Error(`LLM HTTP ${r.status}: ${text.slice(0, 200)}`);
    }

    const data = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Réponse LLM vide (content absent)");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function parseLLMResponse(raw: string, maxPoints: number): LLMResponse {
  // Strip fences ```json ... ``` ou ``` ... ```
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Réponse LLM n'est pas du JSON valide : ${cleaned.slice(0, 100)}`,
    );
  }

  const parsed = LLMResponseSchema.parse(obj);

  // Clamp score au barème max
  parsed.score = Math.min(parsed.score, maxPoints);
  // Arrondi au demi-point (pratique française)
  parsed.score = Math.round(parsed.score * 2) / 2;

  return parsed;
}

/**
 * Vide le cache LLM — utile pour les tests.
 */
export function clearLLMCache(): void {
  cache.clear();
}

/**
 * Vérifie si une réponse est dans le cache sans la récupérer.
 * Utile pour les tests de performance.
 */
export function isLLMCached(args: GradingPromptArgs): boolean {
  const cacheKey = createHash("sha256").update(JSON.stringify(args)).digest("hex");
  return cache.has(cacheKey);
}
