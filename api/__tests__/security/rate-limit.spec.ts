import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkRateLimit, getClientIp, RateLimits } from "../../lib/rate-limit";

/**
 * III.9 — Tests du rate limiter en mémoire.
 */

describe("rate-limit : checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("autorise les premières requêtes sous la limite", () => {
    const key = `test-key-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60_000)).toBe(true);
    }
  });

  it("bloque la requête au-delà de la limite", () => {
    const key = `test-block-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, 5, 60_000);
    }
    expect(checkRateLimit(key, 5, 60_000)).toBe(false);
  });

  it("remet à zéro après la fenêtre de temps", () => {
    const key = `test-reset-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, 5, 1_000);
    }
    expect(checkRateLimit(key, 5, 1_000)).toBe(false);

    // Avance le temps d'une seconde
    vi.advanceTimersByTime(1_001);
    expect(checkRateLimit(key, 5, 1_000)).toBe(true);
  });

  it("des clés différentes ont des compteurs indépendants", () => {
    const key1 = `independent-a-${Math.random()}`;
    const key2 = `independent-b-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key1, 5, 60_000);
    }
    // key1 est bloquée, key2 ne l'est pas
    expect(checkRateLimit(key1, 5, 60_000)).toBe(false);
    expect(checkRateLimit(key2, 5, 60_000)).toBe(true);
  });
});

describe("rate-limit : constantes RateLimits", () => {
  it("session.start : max 5/min", () => {
    expect(RateLimits.sessionStart.max).toBe(5);
    expect(RateLimits.sessionStart.windowMs).toBe(60_000);
  });

  it("cheat.report : max 10/min", () => {
    expect(RateLimits.cheatReport.max).toBe(10);
    expect(RateLimits.cheatReport.windowMs).toBe(60_000);
  });

  it("answer.save : max 30/min", () => {
    expect(RateLimits.answerSave.max).toBe(30);
    expect(RateLimits.answerSave.windowMs).toBe(60_000);
  });

  it("auth : max 5/min", () => {
    expect(RateLimits.auth.max).toBe(5);
    expect(RateLimits.auth.windowMs).toBe(60_000);
  });

  it("heartbeat : max 6/min", () => {
    expect(RateLimits.heartbeat.max).toBe(6);
    expect(RateLimits.heartbeat.windowMs).toBe(60_000);
  });
});

describe("rate-limit : getClientIp", () => {
  it("extrait l'IP depuis x-forwarded-for", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "192.168.1.1, 10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("192.168.1.1");
  });

  it("extrait l'IP depuis x-real-ip en fallback", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "10.0.0.5" },
    });
    expect(getClientIp(req)).toBe("10.0.0.5");
  });

  it("retourne 'unknown' si aucun en-tête IP", () => {
    const req = new Request("http://localhost");
    expect(getClientIp(req)).toBe("unknown");
  });
});
