import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("../../queries/connection", () => ({ getDb: vi.fn() }));
vi.mock("../session-token", () => ({
  verifyStudentToken: vi.fn(),
}));
vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { processHeartbeat } from "../heartbeat";
import { getDb } from "../../queries/connection";
import { verifyStudentToken } from "../session-token";

const NOW = 1_700_000_000_000;
const EXPIRES_AT = NOW + 60_000;

const BASE_CLAIMS = {
  sessionId: 1,
  evaluationId: 1,
  studentName: "Alice",
  startedAt: NOW - 30_000,
  expiresAt: EXPIRES_AT,
};

const BASE_SESSION = {
  id: 1,
  status: "in_progress",
  fingerprintHash: "abc123",
  ipAddress: "1.2.3.4",
  lastHeartbeatAt: new Date(NOW - 15_000),
};

function makeDbMock(session: object | null) {
  const updateSet = vi.fn().mockReturnThis();
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(session ? [session] : []),
    }),
    update: vi.fn().mockReturnValue({
      set: updateSet.mockReturnValue({ where: updateWhere }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(NOW);
});

describe("processHeartbeat", () => {
  it("lève UNAUTHORIZED si le token est invalide", async () => {
    (verifyStudentToken as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Token expiré"),
    );
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(makeDbMock(null));

    await expect(
      processHeartbeat(
        { sessionToken: "bad", clientTime: NOW, focused: true, currentQuestionIndex: 0, fingerprintHash: "x" },
        "1.2.3.4",
      ),
    ).rejects.toThrow(TRPCError);
  });

  it("lève NOT_FOUND si la session n'existe pas", async () => {
    (verifyStudentToken as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_CLAIMS);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(makeDbMock(null));

    await expect(
      processHeartbeat(
        { sessionToken: "tok", clientTime: NOW, focused: true, currentQuestionIndex: 0, fingerprintHash: "abc123" },
        "1.2.3.4",
      ),
    ).rejects.toThrow(TRPCError);
  });

  it("retourne remainingMs > 0 pour une session valide non expirée", async () => {
    (verifyStudentToken as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_CLAIMS);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(makeDbMock(BASE_SESSION));

    const result = await processHeartbeat(
      { sessionToken: "tok", clientTime: NOW, focused: true, currentQuestionIndex: 2, fingerprintHash: "abc123" },
      "1.2.3.4",
    );

    expect(result.remainingMs).toBeGreaterThan(0);
    expect(result.expired).toBe(false);
    expect(result.fingerprintMismatch).toBe(false);
    expect(result.ipMismatch).toBe(false);
  });

  it("détecte le fingerprint mismatch", async () => {
    (verifyStudentToken as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_CLAIMS);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(makeDbMock(BASE_SESSION));

    const result = await processHeartbeat(
      { sessionToken: "tok", clientTime: NOW, focused: true, currentQuestionIndex: 0, fingerprintHash: "different_hash" },
      "1.2.3.4",
    );

    expect(result.fingerprintMismatch).toBe(true);
  });

  it("détecte l'IP mismatch", async () => {
    (verifyStudentToken as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_CLAIMS);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(makeDbMock(BASE_SESSION));

    const result = await processHeartbeat(
      { sessionToken: "tok", clientTime: NOW, focused: true, currentQuestionIndex: 0, fingerprintHash: "abc123" },
      "9.9.9.9",
    );

    expect(result.ipMismatch).toBe(true);
  });

  it("retourne expired=true et remainingMs=0 si le token est expiré", async () => {
    const expiredClaims = { ...BASE_CLAIMS, expiresAt: NOW - 1000 };
    (verifyStudentToken as ReturnType<typeof vi.fn>).mockResolvedValue(expiredClaims);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(makeDbMock(BASE_SESSION));

    const result = await processHeartbeat(
      { sessionToken: "tok", clientTime: NOW, focused: true, currentQuestionIndex: 0, fingerprintHash: "abc123" },
      "1.2.3.4",
    );

    expect(result.expired).toBe(true);
    expect(result.remainingMs).toBe(0);
  });

  it("retourne expired=true si la session n'est plus in_progress", async () => {
    const completedSession = { ...BASE_SESSION, status: "completed" };
    (verifyStudentToken as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_CLAIMS);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(makeDbMock(completedSession));

    const result = await processHeartbeat(
      { sessionToken: "tok", clientTime: NOW, focused: true, currentQuestionIndex: 0, fingerprintHash: "abc123" },
      "1.2.3.4",
    );

    expect(result.expired).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("lève UNAUTHORIZED avec message générique si le rejet n'est pas une Error", async () => {
    (verifyStudentToken as ReturnType<typeof vi.fn>).mockRejectedValue("string-error");
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(makeDbMock(null));

    try {
      await processHeartbeat(
        { sessionToken: "bad", clientTime: NOW, focused: true, currentQuestionIndex: 0, fingerprintHash: "x" },
        "1.2.3.4",
      );
      expect.fail("Devrait lever une erreur");
    } catch (err: unknown) {
      expect((err as { message?: string }).message).toBe("Token invalide");
    }
  });

  it("pas de mismatch si fingerprintHash non encore enregistré (null en BDD)", async () => {
    const freshSession = { ...BASE_SESSION, fingerprintHash: null, ipAddress: null };
    (verifyStudentToken as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_CLAIMS);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(makeDbMock(freshSession));

    const result = await processHeartbeat(
      { sessionToken: "tok", clientTime: NOW, focused: true, currentQuestionIndex: 0, fingerprintHash: "any" },
      "1.2.3.4",
    );

    expect(result.fingerprintMismatch).toBe(false);
    expect(result.ipMismatch).toBe(false);
  });
});
