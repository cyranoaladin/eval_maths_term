import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { STUDENT_SESSION_HEADER } from "./middleware";
import { logger } from "./lib/logger";
import { createOAuthCallbackHandler, createOAuthInitHandler } from "./kimi/auth";
import { csrfMiddleware } from "./lib/csrf";
import { REQUEST_ID_HEADER, normaliserRequestId, withRequestId } from "./lib/request-id";
import { Paths } from "@contracts/constants";

const app = new Hono<{ Bindings: HttpBindings }>();

/**
 * Identifiant de requête — premier middleware, pour que tout ce qui suit en
 * bénéficie. Repris de l'appelant s'il est bien formé, sinon généré. Renvoyé
 * dans la réponse : un utilisateur qui signale une anomalie peut donner cet
 * identifiant, et les journaux du serveur y mènent directement.
 */
app.use("*", async (c, next) => {
  const requestId = normaliserRequestId(c.req.header(REQUEST_ID_HEADER));
  c.header(REQUEST_ID_HEADER, requestId);
  await withRequestId(requestId, () => next());
});

app.use(bodyLimit({ maxSize: 10 * 1024 * 1024 }));

// CORS — autorise uniquement les origines configurées
app.use("/api/*", cors({
  origin: env.allowedOrigins,
  credentials: true,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", STUDENT_SESSION_HEADER],
}));

// Route OAuth — démarrage du flow (génère le state CSRF)
app.get("/api/oauth/login", createOAuthInitHandler());
app.get(Paths.oauthCallback, createOAuthCallbackHandler());

// Health check
app.get("/api/health", async (c) => {
  return c.json({
    status: "ok",
    uptime: process.uptime(),
    serverTime: new Date().toISOString(),
  });
});

// tRPC — avec vérification CSRF sur les mutations
app.use("/api/trpc/*", async (c) => {
  return csrfMiddleware(c.req.raw, async () => {
    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext,
      onError: ({ error, path }) => {
        logger.error(`[tRPC] Erreur sur ${path}`, {
          code: error.code,
          message: error.message,
        });
      },
    });
  });
});
/**
 * Téléchargement des documents d'un tirage.
 *
 * Hors tRPC : ce sont des PDF, et les faire transiter en JSON encodé serait
 * absurde. Trois protections : rôle enseignant exigé, propriété de la classe
 * vérifiée, et nom de fichier pris dans une liste fermée — aucun segment du
 * chemin ne vient de l'URL, donc aucune traversée de répertoire possible.
 */
app.get("/api/paper/:examId/:file", async (c) => {
  const { authenticateRequest } = await import("./kimi/auth");
  const { DOWNLOADABLE, workdirFor } = await import("./paper/paper-service");

  let user;
  try {
    user = await authenticateRequest(c.req.raw.headers);
  } catch {
    return c.json({ error: "Authentification requise" }, 401);
  }
  if (user.role !== "teacher" && user.role !== "admin") {
    return c.json({ error: "Droits insuffisants" }, 403);
  }

  const file = c.req.param("file");
  const descriptor = DOWNLOADABLE[file];
  if (!descriptor) return c.json({ error: "Document inconnu" }, 404);

  const examId = Number.parseInt(c.req.param("examId"), 10);
  if (!Number.isInteger(examId) || examId <= 0) {
    return c.json({ error: "Tirage invalide" }, 400);
  }

  // Vérification de propriété : un enseignant ne télécharge que ses corrigés.
  const { getDb } = await import("./queries/connection");
  const { paperExams, classes } = await import("@db/schema");
  const { and, eq } = await import("drizzle-orm");

  const [row] = await getDb()
    .select({ id: paperExams.id })
    .from(paperExams)
    .innerJoin(classes, eq(classes.id, paperExams.classId))
    .where(and(eq(paperExams.id, examId), eq(classes.ownerId, user.id)))
    .limit(1);

  if (!row) return c.json({ error: "Tirage introuvable" }, 404);

  // Le relevé de notes est produit à la demande : il reflète l'état courant
  // des corrections, y compris les interventions manuelles postérieures au
  // tirage. Le lire sur disque servirait une version périmée.
  if (descriptor.genere) {
    const { buildReleve, renderRelevePdf } = await import("./paper/results-pdf");
    try {
      const releve = await buildReleve(examId);

      if (file.endsWith(".csv")) {
        const { renderReleveCsv, nomFichierCsv } = await import("./paper/results-csv");
        // Téléchargement et non affichage : un tableur n'a rien à faire dans
        // un onglet de navigateur.
        return c.body(renderReleveCsv(releve), 200, {
          "Content-Type": descriptor.type,
          "Content-Disposition": `attachment; filename="${nomFichierCsv(releve)}"`,
          "Cache-Control": "private, no-store",
        });
      }

      const pdf = await renderRelevePdf(releve);
      return c.body(pdf as unknown as ArrayBuffer, 200, {
        "Content-Type": descriptor.type,
        "Content-Disposition": `inline; filename="${file}"`,
        "Cache-Control": "private, no-store",
      });
    } catch (e) {
      logger.error("[paper] Relevé de notes non produit", {
        examId,
        error: String(e).slice(0, 200),
      });
      return c.json({ error: "Relevé indisponible" }, 500);
    }
  }

  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try {
    const contenu = await readFile(join(workdirFor(examId), file));
    return c.body(contenu as unknown as ArrayBuffer, 200, {
      "Content-Type": descriptor.type,
      "Content-Disposition": `inline; filename="${file}"`,
      "Cache-Control": "private, max-age=300",
    });
  } catch {
    return c.json({ error: "Document non produit — relancez la génération." }, 404);
  }
});

app.all("/api/*", (c) => c.json({ error: "Ressource introuvable" }, 404));

/**
 * Le balayage d'inactivité doit tourner de lui-même : sans lui, une copie
 * abandonnée n'est remise que si un autre élève émet un heartbeat. Il ne
 * démarre pas sous `NODE_ENV=test`, où les seuils sont pilotés par les tests.
 */
if (env.nodeEnv !== "test") {
  const { demarrerBalayageInactivite } = await import("./anticheat/idle-scheduler");
  demarrerBalayageInactivite();
}

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
