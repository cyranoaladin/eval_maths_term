/**
 * api/anticheat/heartbeat.ts
 *
 * Traitement d'un heartbeat élève :
 * - Vérifie le token de session (verifyStudentToken)
 * - Met à jour lastHeartbeatAt
 * - Détecte fingerprint mismatch et IP mismatch
 * - Retourne remainingMs calculé côté serveur (jamais trust du client)
 *
 * Note : les cheat_events fingerprint_mismatch / multi_device sont enregistrés
 * par le router (pas ici) pour garder ce module pur et testable.
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { sessions } from "@db/schema";
import {
  verifyStudentToken,
  type StudentSessionPayload,
} from "./session-token";
import { logger } from "../lib/logger";

export interface HeartbeatInput {
  sessionToken: string;
  clientTime: number;
  focused: boolean;
  currentQuestionIndex: number;
  fingerprintHash: string;
}

export interface HeartbeatResult {
  serverTime: number;
  remainingMs: number;
  status: string;
  fingerprintMismatch: boolean;
  ipMismatch: boolean;
  expired: boolean;
}

export async function processHeartbeat(
  input: HeartbeatInput,
  reqIp: string,
): Promise<HeartbeatResult> {
  let claims: StudentSessionPayload;
  try {
    claims = await verifyStudentToken(input.sessionToken);
  } catch (err) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: err instanceof Error ? err.message : "Token invalide",
    });
  }

  const now = Date.now();
  const expired = now > claims.expiresAt;

  const db = getDb();
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, claims.sessionId))
    .limit(1);

  if (!session) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Session inconnue" });
  }

  if (session.status !== "in_progress") {
    return {
      serverTime: now,
      remainingMs: 0,
      status: session.status,
      fingerprintMismatch: false,
      ipMismatch: false,
      expired: true,
    };
  }

  // Détection stricte de changements d'environnement
  const fingerprintMismatch =
    !!session.fingerprintHash &&
    session.fingerprintHash !== input.fingerprintHash;
  const ipMismatch =
    !!session.ipAddress && session.ipAddress !== reqIp;

  if (fingerprintMismatch) {
    logger.warn("Fingerprint mismatch détecté", {
      sessionId: session.id,
      stored: session.fingerprintHash,
      incoming: input.fingerprintHash,
    });
  }
  if (ipMismatch) {
    logger.warn("IP mismatch détecté", {
      sessionId: session.id,
      stored: session.ipAddress,
      incoming: reqIp,
    });
  }

  // Mise à jour lastHeartbeatAt
  await db
    .update(sessions)
    .set({ lastHeartbeatAt: new Date(now) })
    .where(eq(sessions.id, claims.sessionId));

  if (expired) {
    return {
      serverTime: now,
      remainingMs: 0,
      status: "timed_out",
      fingerprintMismatch,
      ipMismatch,
      expired: true,
    };
  }

  return {
    serverTime: now,
    remainingMs: Math.max(0, claims.expiresAt - now),
    status: session.status,
    fingerprintMismatch,
    ipMismatch,
    expired: false,
  };
}
