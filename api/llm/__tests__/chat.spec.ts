/**
 * Le transport vers le service de correction assistée.
 *
 * Le LLM est facultatif : sa panne ne doit jamais empêcher de corriger, mais
 * elle doit être franche. Ce module décide quand réessayer, quand abandonner,
 * et comment lire une réponse mal formée — trois décisions qui, mal prises,
 * transforment une indisponibilité en note fausse.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  chatCompletion, stripJsonFences, withRetry, isLlmConfigured, currentModel,
  LlmNotConfiguredError, LlmTruncatedError,
} from "../chat";

const messages = [{ role: "user" as const, content: "Bonjour" }];

let fetchOrigine: typeof globalThis.fetch;
beforeEach(() => {
  fetchOrigine = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = fetchOrigine;
  vi.useRealTimers();
});

/** Programme les réponses successives du service. */
function servir(...reponses: Array<{ status?: number; corps?: unknown; texte?: string }>) {
  let i = 0;
  globalThis.fetch = vi.fn(async () => {
    const r = reponses[Math.min(i++, reponses.length - 1)];
    const corps = r.texte ?? JSON.stringify(r.corps ?? {});
    return new Response(corps, {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

const reponseNormale = {
  corps: { choices: [{ message: { content: "réponse du modèle" }, finish_reason: "stop" }] },
};

describe("configuration", () => {
  it("se déclare configurée quand la clef est présente", () => {
    expect(isLlmConfigured()).toBe(true);
    expect(currentModel()).toBeTruthy();
  });
});

describe("chatCompletion", () => {
  it("rend le contenu de la réponse", async () => {
    servir(reponseNormale);
    expect(await chatCompletion({ messages })).toBe("réponse du modèle");
  });

  it("réessaie une fois sans format imposé quand le modèle le refuse", async () => {
    // Certains modèles rejettent `response_format` : abandonner à ce stade
    // priverait l'enseignant d'une correction que le service sait rendre.
    servir({ status: 400, texte: "response_format non supporté" }, reponseNormale);
    expect(await chatCompletion({ messages, json: true })).toBe("réponse du modèle");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("signale une erreur du service avec son code", async () => {
    servir({ status: 503, texte: "service indisponible" });
    await expect(chatCompletion({ messages })).rejects.toThrow(/503/);
  });

  it("signale une réponse tronquée plutôt que de la prendre pour bonne", async () => {
    // Une réponse coupée en plein milieu produirait un JSON invalide, donc une
    // correction fantaisiste : mieux vaut le dire.
    servir({
      corps: {
        choices: [{ message: { content: "{\"score\": 1" }, finish_reason: "length" }],
        usage: { completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 480 } },
      },
    });
    await expect(chatCompletion({ messages })).rejects.toBeInstanceOf(LlmTruncatedError);
  });

  it("signale une réponse vide", async () => {
    servir({ corps: { choices: [{ message: {}, finish_reason: "stop" }] } });
    await expect(chatCompletion({ messages })).rejects.toThrow(/vide/i);
  });

  it("signale une réponse sans aucun choix", async () => {
    servir({ corps: {} });
    await expect(chatCompletion({ messages })).rejects.toThrow(/vide/i);
  });

  it("abandonne au-delà du délai imparti", async () => {
    // Sans garde-temps, une remise de copie resterait suspendue à un service
    // qui ne répond pas.
    globalThis.fetch = vi.fn(
      (_u, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ) as typeof globalThis.fetch;
    await expect(chatCompletion({ messages, timeoutMs: 30 })).rejects.toThrow();
  });
});

describe("stripJsonFences", () => {
  it("retire les clôtures dont les modèles entourent leur sortie", () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripJsonFences('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripJsonFences('  {"a":1}  ')).toBe('{"a":1}');
  });
});

describe("withRetry", () => {
  it("rend le résultat dès la première réussite", async () => {
    const fn = vi.fn(async () => "ok");
    expect(await withRetry(fn)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("réessaie puis réussit", async () => {
    vi.useFakeTimers();
    let appels = 0;
    const promesse = withRetry(async () => {
      appels += 1;
      if (appels < 2) throw new Error("panne passagère");
      return "ok";
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await promesse).toBe("ok");
    expect(appels).toBe(2);
  });

  it("abandonne après le nombre de tentatives prévu", async () => {
    vi.useFakeTimers();
    let appels = 0;
    const promesse = withRetry(async () => {
      appels += 1;
      throw new Error("panne durable");
    }, 3).catch((e) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(String(await promesse)).toMatch(/panne durable/);
    expect(appels).toBe(3);
  });

  it("n'insiste pas quand la clef est absente", async () => {
    // Une clef manquante n'est pas une panne passagère : réessayer ne ferait
    // que retarder la correction déterministe.
    let appels = 0;
    await expect(
      withRetry(async () => {
        appels += 1;
        throw new LlmNotConfiguredError();
      }),
    ).rejects.toBeInstanceOf(LlmNotConfiguredError);
    expect(appels).toBe(1);
  });
});
