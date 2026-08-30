/**
 * Les en-têtes posés sur chaque réponse.
 *
 * Ils sont éprouvés de bout en bout par un serveur réel ; ce fichier couvre ce
 * qu'un serveur de développement ne peut pas montrer — la politique de
 * production sur une adresse en https, et celle sur une adresse en clair, qui
 * ne sont pas la même. Une politique qui exige la couche sécurisée sur un
 * serveur en clair rend l'application entièrement blanche : c'est arrivé.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { enTetesDeSecurite } from "../security-headers";
import { env } from "../env";

type EnvMutable = { isProduction: boolean; publicBaseUrl: string };
const initial = { isProduction: env.isProduction, publicBaseUrl: env.publicBaseUrl };

afterEach(() => {
  (env as unknown as EnvMutable).isProduction = initial.isProduction;
  (env as unknown as EnvMutable).publicBaseUrl = initial.publicBaseUrl;
});

/** Une réponse produite par une application qui pose les en-têtes. */
async function reponsePour(chemin: string, avecCache?: string) {
  const app = new Hono();
  app.use("*", enTetesDeSecurite());
  app.get("*", (c) => {
    if (avecCache) c.header("Cache-Control", avecCache);
    return c.text("contenu");
  });
  return app.request(`http://atelier.test${chemin}`);
}

function enProduction(baseUrl: string) {
  (env as unknown as EnvMutable).isProduction = true;
  (env as unknown as EnvMutable).publicBaseUrl = baseUrl;
}

describe("politique de contenu", () => {
  it("interdit l'évaluation dynamique et l'encadrement en production", async () => {
    enProduction("https://atelier.exemple.fr");

    const csp = (await reponsePour("/")).headers.get("Content-Security-Policy")!;

    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    // Sur une adresse sécurisée, tout doit l'emprunter.
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("n'exige pas la couche sécurisée sur une adresse en clair", async () => {
    // C'est le cas de la recette de l'image de production, servie en http sur
    // la boucle locale. La consigne y rendait chaque page blanche sous WebKit.
    enProduction("http://127.0.0.1:3200");

    const csp = (await reponsePour("/")).headers.get("Content-Security-Policy")!;

    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("se desserre en développement, où Vite injecte son client", async () => {
    const csp = (await reponsePour("/")).headers.get("Content-Security-Policy")!;
    expect(csp).toContain("unsafe-eval");
  });
});

describe("transport", () => {
  it("annonce HSTS sur une adresse sécurisée, et seulement là", async () => {
    enProduction("https://atelier.exemple.fr");
    expect((await reponsePour("/")).headers.get("Strict-Transport-Security")).toContain(
      "max-age=31536000",
    );

    enProduction("http://127.0.0.1:3200");
    // L'émettre en clair n'apporte rien et brouille un diagnostic.
    expect((await reponsePour("/")).headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("pose les en-têtes qui ne dépendent d'aucun réglage", async () => {
    const r = await reponsePour("/");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("X-Frame-Options")).toBe("DENY");
    expect(r.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(r.headers.get("Permissions-Policy")).toMatch(/.+/);
    expect(r.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });
});

describe("cache", () => {
  it("garde durablement un fichier dont le nom porte son empreinte", async () => {
    // Vite nomme ses fichiers « app-B7xK2p9q.js » : un tiret, pas un point. Le
    // motif attendait un point, et plus rien n'était mis en cache.
    const r = await reponsePour("/assets/index-B7xK2p9q.js");
    expect(r.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  it("revalide les polices mathématiques, qui n'ont pas d'empreinte", async () => {
    const r = await reponsePour("/mathlive/fonts/KaTeX_Math-Italic.woff2");
    expect(r.headers.get("Cache-Control")).toBe("public, max-age=86400");
  });

  it("interdit le cache de tout le reste", async () => {
    // Un relevé de notes dans le cache du poste du CDI y reste après l'élève.
    for (const chemin of ["/", "/api/trpc/session.getResults", "/eleve/session/12"]) {
      expect((await reponsePour(chemin)).headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("respecte une consigne de cache déjà posée par la route", async () => {
    // Le téléchargement d'un sujet pose la sienne : « privé, cinq minutes ».
    const r = await reponsePour("/api/paper/1/sujet.pdf", "private, max-age=300");
    expect(r.headers.get("Cache-Control")).toBe("private, max-age=300");
  });

  it("ne prend pas pour une empreinte un nom qui n'en porte pas", async () => {
    expect((await reponsePour("/assets/logo.svg")).headers.get("Cache-Control")).toBe("no-store");
  });
});
