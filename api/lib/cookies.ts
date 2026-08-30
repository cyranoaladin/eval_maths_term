/**
 * api/lib/cookies.ts
 *
 * Options des cookies de session.
 *
 * `secure` se décidait sur l'en-tête `Host` : un `Host: localhost:3000` forgé
 * suffisait à obtenir un cookie de session transmissible en clair. En
 * production, l'attribut est posé sans condition — c'est une propriété du
 * déploiement, pas de la requête.
 */
import type { CookieOptions } from "hono/utils/cookie";
import { env } from "./env";

function isLocalhost(headers: Headers): boolean {
  const host = headers.get("host") || "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

export function getSessionCookieOptions(headers: Headers): CookieOptions {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: env.isProduction || !isLocalhost(headers),
  };
}
