/**
 * api/llm/chat.ts
 *
 * Transport LLM partagé — une seule implémentation pour la correction des
 * réponses ouvertes et la génération de questions.
 *
 * Compatible avec toute API « chat completions » de style OpenAI. Par défaut le
 * projet vise OpenRouter, qui expose ce format devant de nombreux modèles.
 *
 * Pièges gérés :
 * - `response_format: json_object` n'est pas supporté par tous les modèles ;
 *   un refus en 400 déclenche une seconde tentative sans ce champ, plutôt que
 *   de faire échouer la requête.
 * - Les modèles encadrent souvent leur JSON dans des clôtures ``` : elles sont
 *   retirées avant analyse.
 * - Une réponse tronquée par le plafond de jetons est détectée via
 *   `finish_reason`. Sans cela, l'erreur remonte sous la forme trompeuse d'un
 *   « JSON invalide » alors que le modèle a simplement été coupé. Les modèles
 *   à raisonnement consomment une part notable du budget avant d'écrire quoi
 *   que ce soit : le plafond doit couvrir raisonnement ET réponse.
 * - OpenRouter recommande les en-têtes `HTTP-Referer` et `X-Title`, utilisés
 *   pour l'attribution dans son tableau de bord.
 */
import { env } from "../lib/env";
import { logger } from "../lib/logger";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  /** Demander explicitement une sortie JSON quand le modèle le supporte. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  model?: string;
}

export class LlmTruncatedError extends Error {
  // Champs déclarés explicitement : les propriétés de paramètre ne sont pas
  // autorisées sous `erasableSyntaxOnly`.
  readonly completionTokens: number;
  readonly reasoningTokens: number;

  constructor(completionTokens: number, reasoningTokens: number) {
    super(
      `Réponse coupée par le plafond de jetons (${completionTokens} jetons produits, dont ${reasoningTokens} de raisonnement). Augmentez le budget ou demandez moins de questions.`,
    );
    this.name = "LlmTruncatedError";
    this.completionTokens = completionTokens;
    this.reasoningTokens = reasoningTokens;
  }
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("LLM_API_KEY non configurée — fonctionnalité assistée indisponible.");
    this.name = "LlmNotConfiguredError";
  }
}

/** Vrai si une clé est configurée : permet de dégrader l'IHM proprement. */
export function isLlmConfigured(): boolean {
  return Boolean(env.llm.apiKey);
}

/** Modèle effectivement utilisé, à afficher à l'enseignant. */
export function currentModel(): string {
  return env.llm.model;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.llm.apiKey}`,
  };
  if (env.llm.apiUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = env.allowedOrigins[0] ?? "http://localhost:3000";
    headers["X-Title"] = env.brandName;
  }
  return headers;
}

function postOnce(
  opts: ChatOptions,
  withJsonFormat: boolean,
  signal: AbortSignal,
): Promise<Response> {
  const body: Record<string, unknown> = {
    model: opts.model ?? env.llm.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? env.llm.maxTokens,
  };
  if (withJsonFormat) body.response_format = { type: "json_object" };

  return fetch(`${env.llm.apiUrl}/chat/completions`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * Envoie une conversation et retourne le contenu brut du premier choix.
 * Lève en cas d'échec — la politique de reprise appartient à l'appelant.
 */
export async function chatCompletion(opts: ChatOptions): Promise<string> {
  if (!isLlmConfigured()) throw new LlmNotConfiguredError();

  // Le garde-temps couvre tout l'échange, lecture du corps comprise. Le placer
  // sur la seule requête ne protégeait rien : sans diffusion en continu, une
  // réponse arrive d'un bloc et c'est la lecture qui prend le temps.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? env.llm.timeoutMs);

  try {
    return await exchange(opts, ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function exchange(opts: ChatOptions, signal: AbortSignal): Promise<string> {
  let response = await postOnce(opts, opts.json === true, signal);

  // Certains modèles rejettent response_format : on retente sans, une fois.
  if (!response.ok && response.status === 400 && opts.json) {
    const detail = await response.text();
    logger.warn("[llm] response_format refusé, seconde tentative sans", {
      model: opts.model ?? env.llm.model,
      detail: detail.slice(0, 160),
    });
    response = await postOnce(opts, false, signal);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: {
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };

  const choice = data.choices?.[0];

  if (choice?.finish_reason === "length") {
    throw new LlmTruncatedError(
      data.usage?.completion_tokens ?? 0,
      data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    );
  }

  const content = choice?.message?.content;
  if (!content) throw new Error("Réponse LLM vide (content absent)");
  return content;
}

/** Retire les clôtures ```json … ``` dont les modèles entourent leur sortie. */
export function stripJsonFences(raw: string): string {
  return raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/**
 * Réessaie une opération avec attente exponentielle (1 s, 3 s, 9 s).
 * Une clé absente n'est pas une panne passagère : on abandonne aussitôt.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  label = "llm",
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof LlmNotConfiguredError) throw e;
      lastError = e;
      logger.warn(`[${label}] tentative ${attempt}/${attempts} échouée`, {
        error: String(e).slice(0, 200),
      });
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, 1000 * 3 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}
