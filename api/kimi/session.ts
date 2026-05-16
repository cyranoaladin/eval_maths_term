import * as jose from "jose";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import type { SessionPayload } from "./types";

const JWT_ALG = "HS256";

/**
 * Secret distinct du APP_SECRET (utilisé uniquement pour OAuth).
 * III.7 : TEACHER_SESSION_SECRET séparé, TTL 12h.
 */
function getTeacherSecret(): Uint8Array {
  return new TextEncoder().encode(env.teacherSessionSecret);
}

export async function signSessionToken(
  payload: SessionPayload,
): Promise<string> {
  const secret = getTeacherSecret();
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret);
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  if (!token) {
    logger.warn("[session-teacher] Aucun token fourni pour la vérification");
    return null;
  }
  try {
    const secret = getTeacherSecret();
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
    });
    const { unionId, clientId } = payload;
    if (!unionId || !clientId) {
      logger.warn("[session-teacher] Payload JWT manquant unionId ou clientId");
      return null;
    }
    return { unionId, clientId } as SessionPayload;
  } catch (error) {
    logger.warn("[session-teacher] Échec de vérification du JWT", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
