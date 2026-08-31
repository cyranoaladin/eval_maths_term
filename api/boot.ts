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
import { enTetesDeSecurite } from "./lib/security-headers";
import { REQUEST_ID_HEADER, normaliserRequestId, withRequestId } from "./lib/request-id";
import { Paths } from "@contracts/constants";
import { EMPREINTE_GIT, VERSION_APPLICATION } from "./lib/version";

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

/**
 * Journal d'accès, au niveau « debug ».
 *
 * Muet en exploitation ordinaire — le niveau par défaut est « info » —, il
 * répond à la seule question qu'on se pose devant une requête qui n'aboutit
 * pas : est-elle seulement arrivée ? Sans lui, une navigation qui reste en
 * attente ne se distingue pas d'une navigation jamais émise.
 */
app.use("*", async (c, next) => {
  const debut = Date.now();
  await next();
  logger.debug("requête", {
    methode: c.req.method,
    chemin: new URL(c.req.url).pathname,
    statut: c.res.status,
    dureeMs: Date.now() - debut,
  });
});

// En-têtes de sécurité — sur toute réponse, y compris les 404 et les erreurs.
app.use("*", enTetesDeSecurite());

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

/**
 * Vivacité : le processus répond-il ?
 *
 * Ne dépend de rien d'extérieur, volontairement. Une base momentanément
 * injoignable ne justifie pas de tuer un serveur qui, lui, fonctionne — et un
 * orchestrateur qui redémarre en boucle sur une panne de base transforme une
 * indisponibilité en incident.
 */
app.get("/api/health", async (c) => {
  return c.json({
    status: "ok",
    uptime: process.uptime(),
    serverTime: new Date().toISOString(),
    version: VERSION_APPLICATION,
    gitSha: EMPREINTE_GIT,
  });
});

/**
 * Disponibilité : le service peut-il prendre du trafic ?
 *
 * Base, schéma, pool, dossier des tirages, disque, outil d'impression. Un
 * `503` retire l'instance de la rotation sans la tuer. Pendant un arrêt en
 * cours, la réponse est `503` dès la première sollicitation : c'est ce qui
 * permet au répartiteur de cesser d'envoyer des élèves avant que le serveur ne
 * ferme.
 */
app.get("/api/ready", async (c) => {
  const { evaluerDisponibilite } = await import("./lib/readiness");
  const { arretDemande } = await import("./lib/arret-gracieux");

  if (arretDemande()) {
    return c.json(
      { pret: false, raison: "arrêt en cours", version: VERSION_APPLICATION },
      503,
    );
  }

  const bilan = await evaluerDisponibilite();
  return c.json(bilan, bilan.pret ? 200 : 503);
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
  // Branchée avant le serveur : une erreur au démarrage doit partir elle aussi.
  const { initialiserSupervision } = await import("./lib/supervision");
  initialiserSupervision();

  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = env.port;
  const serveur = serve({ fetch: app.fetch, port }, () => {
    logger.info("Serveur démarré", {
      port,
      version: VERSION_APPLICATION,
      gitSha: EMPREINTE_GIT,
      // Le réglage effectivement appliqué, pas celui qu'on croit avoir posé.
      keepAliveMs: (serveur as { keepAliveTimeout?: number }).keepAliveTimeout,
    });
  });

  /*
    Le serveur garde ses connexions ouvertes plus longtemps que ceux qui les
    réutilisent.

    Node ferme une connexion inactive au bout de cinq secondes. Un élève qui
    réfléchit plus longtemps entre deux requêtes retrouve une connexion que le
    serveur vient de fermer : sa requête suivante part dans un tuyau déjà clos
    et revient en erreur de transport, sans qu'aucune trace n'apparaisse côté
    serveur — il n'a rien vu passer. Une mesure de charge l'a montré : une
    remise sur deux cents, refusée en une milliseconde, sans erreur applicative.

    Le serveur doit tenir **plus longtemps que le plus patient de ses clients**,
    et c'est ce qui fixe la valeur. Gecko garde une connexion inactive cent
    quinze secondes ; Chromium et WebKit, une soixantaine. Un premier réglage à
    soixante-cinq secondes a supprimé les erreurs de transport sous Chromium
    mais laissait Gecko dans la même situation, en pire : il réutilise une
    connexion que le serveur vient de clore et attend, sans rien dire, qu'un
    délai bien plus long l'en avertisse — une navigation entière peut y passer.
    Cent vingt-cinq secondes passent après tout le monde.

    Le délai d'en-têtes reste au-dessus, sans quoi c'est lui qui coupe.
  */
  // `serve` peut rendre un serveur HTTP/2, qui n'expose pas ces réglages ; on
  // ne les pose que là où ils ont un sens.
  const reglages = serveur as { keepAliveTimeout?: number; headersTimeout?: number };
  if ("keepAliveTimeout" in serveur) reglages.keepAliveTimeout = 125_000;
  if ("headersTimeout" in serveur) reglages.headersTimeout = 126_000;

  // Un redéploiement ou un arrêt de machine ne doit pas couper une remise de
  // copie en deux.
  const { installerArretGracieux } = await import("./lib/arret-gracieux");
  installerArretGracieux(serveur);
}
