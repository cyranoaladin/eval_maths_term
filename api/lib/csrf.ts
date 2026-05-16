import { env } from "./env";
import { logger } from "./logger";

/**
 * Vérifie l'en-tête Origin sur toutes les requêtes mutations tRPC.
 * Protège contre les attaques CSRF.
 *
 * Les requêtes sans Origin (ex: server-to-server) sont refusées en production.
 * En développement, localhost est toujours autorisé.
 */
export function checkOrigin(req: Request): void {
  const origin = req.headers.get("origin");

  if (!origin) {
    // Pas d'Origin — acceptable uniquement hors production (ex: tests Vitest, curl)
    if (env.isProduction) {
      logger.warn("[csrf] Requête sans en-tête Origin refusée en production", {
        url: req.url,
        method: req.method,
      });
      throw new Error("En-tête Origin absent : requête refusée");
    }
    return;
  }

  const allowed = env.allowedOrigins;

  if (!allowed.includes(origin)) {
    logger.warn("[csrf] Origin non autorisée", {
      origin,
      allowed,
      url: req.url,
    });
    throw new Error(`Origin non autorisée : ${origin}`);
  }
}

/**
 * Middleware Hono qui applique la vérification CSRF sur les mutations (POST).
 */
export async function csrfMiddleware(
  req: Request,
  next: () => Promise<Response>,
): Promise<Response> {
  if (req.method === "POST" || req.method === "PUT" || req.method === "DELETE") {
    try {
      checkOrigin(req);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : "CSRF check failed" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
  }
  return next();
}
