import * as jose from "jose";
import { env } from "../lib/env";
import { logger } from "../lib/logger";

const JWT_ALG = "HS256";

/**
 * Payload du token de session élève.
 * Contient toutes les informations nécessaires pour valider une requête élève
 * sans requête BDD supplémentaire.
 */
export interface StudentSessionPayload {
  sessionId: number;
  evaluationId: number;
  studentName: string;
  startedAt: number;
  expiresAt: number;
  shuffleSeed: string;
}

/**
 * Payload du token de résultats (émis à la soumission, TTL court).
 */
export interface ResultsTokenPayload {
  sessionId: number;
  issuedAt: number;
  expiresAt: number;
}

function getSecret(): Uint8Array {
  return new TextEncoder().encode(env.studentSessionSecret);
}

/**
 * Signe un token de session élève.
 * TTL = durée de l'évaluation + 30 secondes de grâce (jamais plus).
 */
export async function signStudentToken(
  payload: StudentSessionPayload,
): Promise<string> {
  const secret = getSecret();
  const ttlSeconds = Math.ceil((payload.expiresAt - Date.now()) / 1000) + 30;
  return new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret);
}

/**
 * Vérifie et décode un token de session élève.
 * Lance une erreur si le token est invalide, expiré ou mal formé.
 */
export async function verifyStudentToken(
  token: string,
): Promise<StudentSessionPayload> {
  try {
    const secret = getSecret();
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
    });

    const { sessionId, evaluationId, studentName, startedAt, expiresAt, shuffleSeed } = payload;

    if (
      typeof sessionId !== "number" ||
      typeof evaluationId !== "number" ||
      typeof studentName !== "string" ||
      typeof startedAt !== "number" ||
      typeof expiresAt !== "number" ||
      typeof shuffleSeed !== "string"
    ) {
      throw new Error("Payload du token de session élève invalide");
    }

    if (Date.now() > expiresAt) {
      throw new Error("Session expirée : le temps imparti est écoulé");
    }

    return { sessionId, evaluationId, studentName, startedAt, expiresAt, shuffleSeed };
  } catch (err) {
    logger.warn("[session-token] Échec de vérification du token élève", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Signe un token de résultats à durée courte (10 minutes).
 * Émis uniquement après soumission réussie.
 */
export async function signResultsToken(sessionId: number): Promise<string> {
  const secret = getSecret();
  const now = Date.now();
  const expiresAt = now + 10 * 60 * 1000;
  return new jose.SignJWT({ sessionId, issuedAt: now, expiresAt })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret);
}

/**
 * Vérifie un token de résultats.
 */
export async function verifyResultsToken(
  token: string,
): Promise<ResultsTokenPayload> {
  try {
    const secret = getSecret();
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
    });

    const { sessionId, issuedAt, expiresAt } = payload;

    if (
      typeof sessionId !== "number" ||
      typeof issuedAt !== "number" ||
      typeof expiresAt !== "number"
    ) {
      throw new Error("Payload du token de résultats invalide");
    }

    return { sessionId, issuedAt, expiresAt };
  } catch (err) {
    logger.warn("[session-token] Échec de vérification du token de résultats", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
