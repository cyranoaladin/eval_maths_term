/**
 * e2e/fixtures.ts
 *
 * Session enseignant pour les tests navigateur.
 *
 * L'OAuth Kimi n'est pas disponible hors production : le cookie est fabriqué
 * avec le secret de session, comme le fait `scripts/dev-session.ts`. Le test
 * n'emprunte donc aucun chemin détourné dans l'application.
 */
import { test as base, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

let cookieCache: string | null = null;

export function cookieEnseignant(): string {
  if (cookieCache) return cookieCache;
  const sortie = execFileSync("npx", ["tsx", "scripts/dev-session.ts"], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
  const m = sortie.match(/kimi_sid=([^;]+)/);
  if (!m) throw new Error("Impossible d'obtenir une session enseignant");
  cookieCache = m[1];
  return cookieCache;
}

/** Erreurs console et exceptions collectées pendant un test. */
export function collecterErreurs(page: Page): string[] {
  const erreurs: string[] = [];
  page.on("pageerror", (e) => erreurs.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const texte = m.text();
    // Le navigateur réclame une icône que le serveur de développement ne sert
    // pas : sans rapport avec l'application.
    if (/favicon\.ico/.test(texte)) return;
    erreurs.push(`console: ${texte}`);
  });
  return erreurs;
}

export const test = base.extend<{ enseignant: Page }>({
  enseignant: async ({ browser, baseURL }, use) => {
    const ctx = await browser.newContext({ baseURL });
    await ctx.addCookies([
      {
        name: "kimi_sid",
        value: cookieEnseignant(),
        domain: new URL(baseURL!).hostname,
        path: "/",
      },
    ]);
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
});

export { expect } from "@playwright/test";
