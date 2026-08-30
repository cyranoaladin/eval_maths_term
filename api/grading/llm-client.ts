/**
 * api/grading/llm-client.ts
 *
 * Correction d'une réponse élève par le LLM.
 *
 * Le transport vit dans `api/llm/chat.ts`, partagé avec la génération de
 * questions. Ce module ne porte que la sémantique de correction :
 * - Cache LRU par SHA-256 des arguments (TTL 1 h, 1000 entrées)
 * - Score plafonné au barème et arrondi au demi-point (usage français)
 */
import { LRUCache } from "lru-cache";
import { createHash } from "node:crypto";
import { z } from "zod";
import { chatCompletion, isLlmConfigured, stripJsonFences, withRetry } from "../llm/chat";
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
  if (!isLlmConfigured()) {
    throw new Error("LLM_API_KEY non configurée — correction LLM impossible");
  }

  const cacheKey = createHash("sha256").update(JSON.stringify(args)).digest("hex");
  const cached = cache.get(cacheKey);
  if (cached) {
    logger.debug("LLM cache hit", { cacheKey });
    return cached;
  }

  const messages = buildGradingPrompt(args);

  const parsed = await withRetry(async () => {
    const raw = await chatCompletion({ messages, json: true });
    return parseLLMResponse(raw, args.maxPoints);
  }, 3, "llm-grading");

  cache.set(cacheKey, parsed);
  logger.info("LLM correction réussie", {
    score: parsed.score,
    confidence: parsed.confidence,
  });
  return parsed;
}

function parseLLMResponse(raw: string, maxPoints: number): LLMResponse {
  const cleaned = stripJsonFences(raw);

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
