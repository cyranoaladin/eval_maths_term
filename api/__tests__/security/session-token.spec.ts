import { describe, it, expect, beforeAll } from "vitest";
import { signStudentToken, verifyStudentToken, signResultsToken, verifyResultsToken } from "../../anticheat/session-token";

const VALID_PAYLOAD = {
  sessionId: 42,
  evaluationId: 1,
  studentName: "Alice Dupont",
  startedAt: Date.now(),
  expiresAt: Date.now() + 60 * 60 * 1000, // +1h
  shuffleSeed: "abc123def456",
};

describe("session-token : token de session élève", () => {
  let token: string;

  beforeAll(async () => {
    token = await signStudentToken(VALID_PAYLOAD);
  });

  it("signe et vérifie un token valide", async () => {
    const payload = await verifyStudentToken(token);
    expect(payload.sessionId).toBe(VALID_PAYLOAD.sessionId);
    expect(payload.evaluationId).toBe(VALID_PAYLOAD.evaluationId);
    expect(payload.studentName).toBe(VALID_PAYLOAD.studentName);
    expect(payload.shuffleSeed).toBe(VALID_PAYLOAD.shuffleSeed);
  });

  it("rejette un token falsifié", async () => {
    const parts = token.split(".");
    const tamperedPayload = btoa(JSON.stringify({ ...VALID_PAYLOAD, sessionId: 999 }));
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    await expect(verifyStudentToken(tampered)).rejects.toThrow();
  });

  it("rejette un token expiré", async () => {
    const expiredToken = await signStudentToken({
      ...VALID_PAYLOAD,
      expiresAt: Date.now() - 1000, // déjà expiré
    });
    await expect(verifyStudentToken(expiredToken)).rejects.toThrow(/expir/i);
  });

  it("rejette un token avec mauvais secret (replay depuis autre env)", async () => {
    // Token signé avec un secret différent — simule un replay d'un autre environnement
    const FAKE_SECRET = "fake_secret_completely_different_from_real_one_xxxxxxxxxx";
    const jose = await import("jose");
    const badToken = await new jose.SignJWT({ ...VALID_PAYLOAD })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(FAKE_SECRET));
    await expect(verifyStudentToken(badToken)).rejects.toThrow();
  });

  it("rejette un token vide", async () => {
    await expect(verifyStudentToken("")).rejects.toThrow();
  });
});

describe("session-token : token de résultats", () => {
  it("signe et vérifie un token de résultats", async () => {
    const token = await signResultsToken(42);
    const payload = await verifyResultsToken(token);
    expect(payload.sessionId).toBe(42);
    expect(payload.expiresAt).toBeGreaterThan(Date.now());
  });

  it("le token de résultats expire en 10 minutes", async () => {
    const token = await signResultsToken(1);
    const payload = await verifyResultsToken(token);
    const ttlMs = payload.expiresAt - payload.issuedAt;
    expect(ttlMs).toBeGreaterThanOrEqual(9 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(11 * 60 * 1000);
  });
});
