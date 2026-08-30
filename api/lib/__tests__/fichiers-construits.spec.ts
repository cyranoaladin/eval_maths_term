/**
 * Le service des fichiers construits.
 *
 * L'application est une page unique : recharger `/eleve/session/12` doit rendre
 * la page, pas un 404. Mais rendre la page à *tout* ce qui manque masquerait
 * les vraies absences — un appel d'API mal orthographié répondrait 200 avec du
 * HTML, et le client tenterait d'en lire du JSON.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveStaticFiles, racineParDefaut } from "../vite";

let racine = "";
const application = new Hono<{ Bindings: HttpBindings }>();

beforeAll(async () => {
  racine = await mkdtemp(join(tmpdir(), "public-"));
  await mkdir(join(racine, "assets"), { recursive: true });
  await writeFile(join(racine, "index.html"), "<!doctype html><title>Atelier</title>", "utf8");
  await writeFile(join(racine, "assets", "app-abcdef12.js"), "console.log(1)", "utf8");
  serveStaticFiles(application, racine);
});

afterAll(async () => {
  await rm(racine, { recursive: true, force: true });
});

it("rend la page sur une route inconnue demandée par un navigateur", async () => {
  const reponse = await application.request("http://atelier.test/eleve/session/12", {
    headers: { accept: "text/html,application/xhtml+xml" },
  });

  expect(reponse.status).toBe(200);
  await expect(reponse.text()).resolves.toContain("<title>Atelier</title>");
});

it("répond 404 en JSON à ce qui ne demande pas de page", async () => {
  const reponse = await application.request("http://atelier.test/api/trcp/mal-orthographie", {
    headers: { accept: "application/json" },
  });

  expect(reponse.status).toBe(404);
  await expect(reponse.json()).resolves.toEqual({ error: "Not Found" });
});

it("répond 404 en JSON à une requête sans préférence déclarée", async () => {
  const reponse = await application.request("http://atelier.test/inconnu");
  expect(reponse.status).toBe(404);
});

it("place la racine à côté du serveur construit", () => {
  // Le serveur est bundlé dans `dist/` : les fichiers de l'IHM sont ses voisins.
  expect(racineParDefaut().endsWith("/dist/public")).toBe(true);
});
