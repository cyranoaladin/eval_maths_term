/**
 * L'ordonnanceur du balayage d'inactivité.
 *
 * Il existe parce que le balayage ne tournait jamais de lui-même : une copie
 * abandonnée en fin d'épreuve n'était remise que si un autre élève émettait un
 * signal. Ce qui compte ici est qu'il démarre, qu'il ne démarre qu'une fois, et
 * qu'il ne retienne pas le processus au moment de l'arrêt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const balayages = vi.hoisted(() => ({ nombre: 0, echoue: false }));
vi.mock("../idle-sweeper", () => ({
  runIdleSweep: async () => {
    balayages.nombre += 1;
    if (balayages.echoue) throw new Error("base injoignable");
    return { checked: 0, warned: 0, autoSubmitted: 0, errors: 0 };
  },
}));

const { demarrerBalayageInactivite, arreterBalayageInactivite, INTERVALLE_BALAYAGE_MS } =
  await import("../idle-scheduler");

beforeEach(() => {
  balayages.nombre = 0;
  balayages.echoue = false;
  vi.useFakeTimers();
});

afterEach(() => {
  arreterBalayageInactivite();
  vi.useRealTimers();
});

describe("demarrerBalayageInactivite", () => {
  it("déclenche le balayage à intervalle régulier", async () => {
    demarrerBalayageInactivite(1_000);
    expect(balayages.nombre).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(balayages.nombre).toBe(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(balayages.nombre).toBe(4);
  });

  it("ne démarre pas deux fois", async () => {
    // Deux ordonnanceurs doubleraient la charge sans rien détecter de plus.
    demarrerBalayageInactivite(1_000);
    demarrerBalayageInactivite(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(balayages.nombre).toBe(1);
  });

  it("s'arrête et peut redémarrer", async () => {
    demarrerBalayageInactivite(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    arreterBalayageInactivite();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(balayages.nombre).toBe(1);

    demarrerBalayageInactivite(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(balayages.nombre).toBe(2);
  });

  it("s'arrête sans erreur même s'il ne tournait pas", () => {
    expect(() => arreterBalayageInactivite()).not.toThrow();
  });

  it("survit à un balayage en échec", async () => {
    // Une base momentanément injoignable ne doit pas éteindre la surveillance.
    balayages.echoue = true;
    demarrerBalayageInactivite(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(balayages.nombre).toBe(2);
  });

  it("retient un intervalle court devant les seuils métier", () => {
    // Les seuils sont à 60 et 180 secondes : un balayage plus lent les
    // rendrait imprécis.
    expect(INTERVALLE_BALAYAGE_MS).toBeLessThanOrEqual(30_000);
  });
});
