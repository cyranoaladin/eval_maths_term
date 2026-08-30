/**
 * api/lib/vite.ts
 *
 * Service des fichiers construits, en production.
 *
 * L'application est une page unique : toute route inconnue qui demande du HTML
 * doit rendre `index.html`, sinon un rechargement sur `/eleve/session/12`
 * tombe sur un 404. Une requête qui ne demande pas de HTML — un appel d'API mal
 * orthographié, un actif absent — reçoit un 404 en JSON : lui rendre la page
 * d'accueil ferait passer une erreur pour un succès.
 */
import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

/** Emplacement des fichiers construits, à côté du serveur bundlé. */
export function racineParDefaut(): string {
  return path.resolve(import.meta.dirname, "../dist/public");
}

export function serveStaticFiles(app: App, racine: string = racineParDefaut()) {
  // `serveStatic` lit ses chemins depuis le répertoire courant ; le repli lit
  // le sien en absolu. Les deux se déduisent d'une seule racine : quand elles
  // divergeaient, la page se chargeait mais aucun actif ne suivait.
  const relative = path.relative(process.cwd(), racine) || ".";
  app.use("*", serveStatic({ root: relative }));

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    return c.html(fs.readFileSync(path.resolve(racine, "index.html"), "utf-8"));
  });
}
