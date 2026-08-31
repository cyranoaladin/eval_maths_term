/**
 * `Cross-Origin-Opener-Policy: same-origin` isole la page de tout ce qui
 * l'ouvre. C'est une protection du produit, et le produit ne la relâche jamais.
 *
 * Un seul endroit la contourne : le navigateur Firefox piloté par Playwright,
 * dont le protocole d'automatisation se perd lorsque Gecko échange le groupe de
 * contextes de navigation — `page.goto` ne rend alors jamais la main. Le
 * contournement vit dans `e2e/fixtures.ts`, il est documenté sur place, et il
 * ne s'applique qu'au navigateur de test.
 *
 * Ce fichier existe pour qu'il y reste. Une préférence Gecko recopiée dans le
 * produit, un en-tête rendu conditionnel « le temps de déboguer », et la
 * protection disparaît sans que personne ne s'en aperçoive.
 *
 * La preuve que Firefox tient réellement COOP sur le vrai build est faite
 * ailleurs, hors de Playwright : `scripts/smoke-firefox-coop.mjs`.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Hono } from "hono";
import { enTetesDeSecurite } from "../security-headers";
import { env } from "../env";

const run = promisify(execFile);

type EnvMutable = { isProduction: boolean; publicBaseUrl: string };
const initial = { isProduction: env.isProduction, publicBaseUrl: env.publicBaseUrl };

afterEach(() => {
  (env as unknown as EnvMutable).isProduction = initial.isProduction;
  (env as unknown as EnvMutable).publicBaseUrl = initial.publicBaseUrl;
});

async function coopPour(isProduction: boolean, baseUrl: string) {
  (env as unknown as EnvMutable).isProduction = isProduction;
  (env as unknown as EnvMutable).publicBaseUrl = baseUrl;
  const app = new Hono();
  app.use("*", enTetesDeSecurite());
  app.get("*", (c) => c.text("contenu"));
  const r = await app.request("http://atelier.test/");
  return r.headers.get("Cross-Origin-Opener-Policy");
}

/** La préférence Gecko qui désactive l'application de COOP. */
const PREFERENCE = "browser.tabs.remote.useCrossOriginOpenerPolicy";

describe("COOP ne se désactive pas", () => {
  it("est posé quelle que soit la configuration", async () => {
    // Les quatre combinaisons qui existent en vrai : production ou non,
    // adresse sécurisée ou non. Aucune ne relâche l'isolation.
    expect(await coopPour(true, "https://atelier.exemple.fr")).toBe("same-origin");
    expect(await coopPour(true, "http://192.168.1.10:3000")).toBe("same-origin");
    expect(await coopPour(false, "https://recette.exemple.fr")).toBe("same-origin");
    expect(await coopPour(false, "http://localhost:3000")).toBe("same-origin");
  });

  it("n'est relâché par aucun fichier du produit", async () => {
    // `git grep` plutôt qu'un parcours de disque : il ignore d'office
    // `node_modules`, les artefacts de build et tout ce que `.gitignore` couvre.
    const { stdout } = await run("git", ["grep", "-l", PREFERENCE, "--", "."], {
      cwd: process.cwd(),
    }).catch(() => ({ stdout: "" }));

    // La documentation a le droit d'en parler — c'est même souhaitable. Ce que
    // ce test interdit, c'est du code ou de la configuration qui l'applique.
    const fichiers = stdout
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.endsWith(".md"))
      .sort();

    // Le harnais de test, et lui seul. `playwright.config.ts` importe la
    // préférence depuis `e2e/fixtures.ts` sans la réécrire.
    expect(fichiers).toEqual(["e2e/fixtures.ts"]);
  });

  it("porte, là où il vit, l'explication de sa présence", async () => {
    const fixtures = await readFile("e2e/fixtures.ts", "utf8");
    const bloc = fixtures.slice(0, fixtures.indexOf(PREFERENCE));

    // Un contournement sans motif écrit devient, six mois plus tard, un choix
    // que plus personne n'ose défaire.
    expect(bloc).toMatch(/playwright/i);
    expect(bloc).toMatch(/gecko|firefox/i);
    // Et surtout : que la portée est le navigateur de test, pas le produit.
    expect(bloc).toMatch(/navigateur de test|ce navigateur/i);
  });
});
