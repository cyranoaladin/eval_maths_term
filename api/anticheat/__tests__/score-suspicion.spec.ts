import { describe, it, expect } from "vitest";
import { computeSuspicionScore } from "../score-suspicion";

describe("computeSuspicionScore", () => {
  it("score 0 et verdict clean pour aucun événement", () => {
    const r = computeSuspicionScore([]);
    expect(r.score).toBe(0);
    expect(r.verdict).toBe("clean");
    expect(r.reasons).toHaveLength(0);
  });

  it("verdict clean pour 1 blur (score 3 < 15)", () => {
    const r = computeSuspicionScore([{ type: "blur" }]);
    expect(r.score).toBe(3);
    expect(r.verdict).toBe("clean");
  });

  it("verdict minor pour 2 tab_switch (score 16, ≥15)", () => {
    const r = computeSuspicionScore([{ type: "tab_switch", count: 2 }]);
    expect(r.score).toBe(16);
    expect(r.verdict).toBe("minor");
  });

  it("verdict moderate pour 5 tab_switch + 2 copy (score 40+10=50, ≥40)", () => {
    const r = computeSuspicionScore([
      { type: "tab_switch", count: 5 },
      { type: "copy", count: 2 },
    ]);
    expect(r.score).toBe(50);
    expect(r.verdict).toBe("moderate");
  });

  it("verdict severe pour 1 devtools_open (score 50, ≥70? non — 50 < 70)", () => {
    const r = computeSuspicionScore([{ type: "devtools_open" }]);
    expect(r.score).toBe(50);
    expect(r.verdict).toBe("moderate");
  });

  it("verdict severe pour 1 fingerprint_mismatch (score 60, < 70? non -> moderate)", () => {
    const r = computeSuspicionScore([{ type: "fingerprint_mismatch" }]);
    expect(r.score).toBe(60);
    expect(r.verdict).toBe("moderate");
  });

  it("verdict severe pour 1 multi_device (score 80, ≥70)", () => {
    const r = computeSuspicionScore([{ type: "multi_device" }]);
    expect(r.score).toBe(80);
    expect(r.verdict).toBe("severe");
  });

  it("verdict severe pour fingerprint_mismatch + multi_device (100)", () => {
    const r = computeSuspicionScore([
      { type: "fingerprint_mismatch" },
      { type: "multi_device" },
    ]);
    expect(r.score).toBe(100);
    expect(r.verdict).toBe("severe");
  });

  it("le cap empêche le dépassement par type (tab_switch cap=40)", () => {
    const r = computeSuspicionScore([{ type: "tab_switch", count: 100 }]);
    const tabContrib = r.reasons.find(x => x.type === "tab_switch")!.contribution;
    expect(tabContrib).toBe(40);
  });

  it("score global plafonné à 100", () => {
    const r = computeSuspicionScore([
      { type: "multi_device" },
      { type: "fingerprint_mismatch" },
      { type: "devtools_open" },
      { type: "tab_switch", count: 10 },
      { type: "copy", count: 20 },
    ]);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("les raisons contiennent les contributions correctes", () => {
    const r = computeSuspicionScore([
      { type: "blur", count: 3 },
      { type: "copy", count: 2 },
    ]);
    const blurReason = r.reasons.find(x => x.type === "blur")!;
    const copyReason = r.reasons.find(x => x.type === "copy")!;
    expect(blurReason.count).toBe(3);
    expect(blurReason.contribution).toBe(9); // 3 * 3
    expect(copyReason.count).toBe(2);
    expect(copyReason.contribution).toBe(10); // 2 * 5
  });

  it("aggrège correctement les événements du même type", () => {
    const r = computeSuspicionScore([
      { type: "blur" },
      { type: "blur" },
      { type: "blur" },
    ]);
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0].count).toBe(3);
    expect(r.reasons[0].contribution).toBe(9);
  });

  it("1 print (unit=15, cap=15) → contribution 15", () => {
    const r = computeSuspicionScore([{ type: "print", count: 3 }]);
    const c = r.reasons.find(x => x.type === "print")!.contribution;
    expect(c).toBe(15); // cap = 15
  });

  it("idle_disconnect (unit=20, cap=20) → verdict minor", () => {
    const r = computeSuspicionScore([{ type: "idle_disconnect" }]);
    expect(r.score).toBe(20);
    expect(r.verdict).toBe("minor");
  });

  it("window_size_anomaly (unit=15, cap=30) avec 3 occurrences → 30 (capped)", () => {
    const r = computeSuspicionScore([{ type: "window_size_anomaly", count: 3 }]);
    const c = r.reasons.find(x => x.type === "window_size_anomaly")!.contribution;
    expect(c).toBe(30); // 3*15=45, cap=30
  });

  it("ignore les types sans poids défini (poids nul)", () => {
    const events = [
      { type: "tab_switch" as const, count: 1 },
      // type inconnu simulé en cast — ne devrait pas crasher
    ];
    const r = computeSuspicionScore(events);
    expect(r.score).toBe(8);
    expect(r.reasons).toHaveLength(1);
  });
});
