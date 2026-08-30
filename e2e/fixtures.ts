/**
 * e2e/fixtures.ts
 *
 * Session enseignant pour les tests navigateur.
 *
 * L'OAuth Kimi n'est pas disponible hors production : le cookie est fabriqué
 * avec le secret de session, comme le fait `scripts/dev-session.ts`. Le test
 * n'emprunte donc aucun chemin détourné dans l'application.
 */
import { test as base, expect, type Page } from "@playwright/test";
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

/**
 * Donne le focus au champ mathématique et attend qu'il le détienne réellement.
 *
 * MathLive ne prend pas le focus au moment du clic : il le déplace ensuite vers
 * un puits de saisie caché dans son shadow DOM. Pendant ce court intervalle,
 * `document.activeElement` reste l'élément précédent — le bouton « Suivant » —
 * et toute frappe y est perdue. Un élève ne peut pas frapper en moins de dix
 * millisecondes après un clic ; un robot, si. On attend donc la condition
 * observable plutôt qu'une temporisation arbitraire.
 */
export async function focaliserMath(page: Page): Promise<void> {
  const champ = page.locator("math-field");
  await champ.click();
  await expect
    .poll(
      () =>
        champ.evaluate(
          (el) => el.contains(document.activeElement) || document.activeElement === el,
        ),
      { message: "le champ mathématique n'a jamais reçu le focus" },
    )
    .toBe(true);
}
