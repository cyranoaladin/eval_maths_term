import { describe, it, expect } from "vitest";
import {
  computeFingerprintHash,
  compareFingerprints,
} from "../fingerprint";
import type { FingerprintComponents } from "@contracts/fingerprint-canonical";

const BASE: FingerprintComponents = {
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
  language: "fr-FR",
  languages: ["fr-FR", "fr", "en"],
  screen: { width: 1920, height: 1080, colorDepth: 24, devicePixelRatio: 1 },
  timezone: "Europe/Paris",
  timezoneOffset: -60,
  hardwareConcurrency: 8,
  platform: "Linux x86_64",
  canvasHash: "a1b2c3d4",
  webglRenderer: "NVIDIA GeForce RTX 3080",
};

describe("computeFingerprintHash", () => {
  it("produit un hash SHA-256 de 64 caractères hex", () => {
    const h = computeFingerprintHash(BASE);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("est déterministe — même entrée → même hash", () => {
    expect(computeFingerprintHash(BASE)).toBe(computeFingerprintHash(BASE));
  });

  it("change si userAgent change", () => {
    const modified = { ...BASE, userAgent: "Mozilla/5.0 (Windows NT 10.0)" };
    expect(computeFingerprintHash(BASE)).not.toBe(computeFingerprintHash(modified));
  });

  it("change si la résolution change", () => {
    const modified = { ...BASE, screen: { ...BASE.screen, width: 1366 } };
    expect(computeFingerprintHash(BASE)).not.toBe(computeFingerprintHash(modified));
  });

  it("change si le canvasHash change", () => {
    const modified = { ...BASE, canvasHash: "ffffffff" };
    expect(computeFingerprintHash(BASE)).not.toBe(computeFingerprintHash(modified));
  });

  it("change si la timezone change", () => {
    const modified = { ...BASE, timezone: "America/New_York", timezoneOffset: 300 };
    expect(computeFingerprintHash(BASE)).not.toBe(computeFingerprintHash(modified));
  });

  it("change si webglRenderer change", () => {
    const modified = { ...BASE, webglRenderer: "AMD Radeon RX 6800" };
    expect(computeFingerprintHash(BASE)).not.toBe(computeFingerprintHash(modified));
  });

  it("l'ordre des languages est normalisé (sort) — fr,en = en,fr", () => {
    const a = computeFingerprintHash({ ...BASE, languages: ["fr", "en"] });
    const b = computeFingerprintHash({ ...BASE, languages: ["en", "fr"] });
    expect(a).toBe(b);
  });
});

describe("compareFingerprints", () => {
  it("match: true si les hashs sont identiques", () => {
    const h = computeFingerprintHash(BASE);
    expect(compareFingerprints(h, h).match).toBe(true);
  });

  it("match: false si les hashs diffèrent", () => {
    const h1 = computeFingerprintHash(BASE);
    const h2 = computeFingerprintHash({ ...BASE, platform: "Win32" });
    const result = compareFingerprints(h1, h2);
    expect(result.match).toBe(false);
    expect(result.reason).toContain("Hash différent");
  });

  it("match: true retourne une raison lisible", () => {
    const h = computeFingerprintHash(BASE);
    expect(compareFingerprints(h, h).reason).toContain("identique");
  });
});
