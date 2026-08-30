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

/**
 * Tout ce qu'un navigateur signale et qu'on ne devrait pas voir.
 *
 * Exceptions non rattrapées, erreurs de console — les avertissements React
 * critiques en font partie —, et réponses en 5xx. Aucun filtre global : une
 * erreur attendue se déclare dans le test qui l'attend, avec le motif exact.
 * Un filtre posé ici masquerait la même chose partout, y compris là où
 * personne ne l'a prévue.
 */
export function collecterErreurs(page: Page): string[] {
  const erreurs: string[] = [];
  page.on("pageerror", (e) => erreurs.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    erreurs.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500) erreurs.push(`http ${r.status()}: ${r.url()}`);
  });
  return erreurs;
}

/** Ce qu'un test peut tolérer, et rien de plus. */
export interface Surveillance {
  /** Déclare une anomalie attendue, avec le motif qui la reconnaît. */
  tolerer(motif: RegExp, raison: string): void;
}

export const test = base.extend<{ enseignant: Page; surveillance: Surveillance }>({
  /**
   * Installée sur chaque test, sans qu'il ait à la demander.
   *
   * La surveillance des erreurs navigateur existait, mais il fallait y penser :
   * un test qui l'oubliait passait sur une page qui hurlait dans la console.
   * Elle est maintenant automatique, et c'est le test qui déclare ce qu'il
   * attend — pas l'inverse.
   */
  surveillance: [
    async ({ page }, use) => {
      const anomalies = collecterErreurs(page);
      const tolerances: Array<{ motif: RegExp; raison: string }> = [];

      await use({
        tolerer(motif, raison) {
          tolerances.push({ motif, raison });
        },
      });

      const restantes = anomalies.filter(
        (a) => !tolerances.some((t) => t.motif.test(a)),
      );
      expect(
        restantes,
        `Le navigateur a signalé ce que personne n'attendait :\n  ${restantes.join("\n  ")}`,
      ).toEqual([]);
    },
    { auto: true },
  ],

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
 * millisecondes après un clic ; un robot, si.
 *
 * La condition attendue est le puits lui-même, pas le `<math-field>` : sous
 * Gecko et WebKit, l'élément hôte se déclare actif avant que le puits ne le
 * soit, et les frappes émises dans cet intervalle n'arrivent nulle part.
 */
export async function focaliserMath(page: Page): Promise<void> {
  const champ = page.locator("math-field");
  await champ.click();
  await expect
    .poll(
      () =>
        champ.evaluate((el) => {
          const puits = el.shadowRoot?.activeElement;
          return puits instanceof Element
            ? puits.classList.contains("ML__keyboard-sink")
            : false;
        }),
      { message: "le puits de saisie de MathLive n'a jamais reçu le focus" },
    )
    .toBe(true);
}

/**
 * Ce que le serveur détient réellement pour la session ouverte dans cet onglet.
 *
 * Sert aux messages d'échec : « la réponse est perdue » n'a pas le même sens
 * selon qu'elle manque en base ou qu'elle n'est pas revenue à l'écran.
 */
export async function brouillonsDuServeur(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const jeton = sessionStorage.getItem("session-eleve") ?? "";
    if (!jeton) return "(pas de jeton de session)";
    const r = await fetch("/api/trpc/answer.listDrafts", {
      headers: { "x-student-session-token": jeton },
    });
    if (!r.ok) return `HTTP ${r.status}`;
    const corps = (await r.json()) as {
      result?: { data?: { json?: Array<{ questionId: number; answer: string }> } };
    };
    const brouillons = corps.result?.data?.json ?? [];
    return brouillons.map((b) => `${b.questionId}:${b.answer}`).join(" , ") || "(aucun)";
  });
}

/**
 * Parcourt toutes les questions et relève les formules effectivement affichées.
 *
 * La navigation passe par les pastilles numérotées, et chaque étape attend que
 * l'en-tête confirme le changement : enchaîner des « Suivant » à intervalle fixe
 * faisait manquer des questions — le champ n'était pas encore rendu au moment
 * où on le cherchait, et une réponse bien présente en base passait pour perdue.
 *
 * Chaque champ dispose ensuite d'un délai borné pour recevoir sa valeur : les
 * brouillons arrivent du serveur après le rendu.
 */
export async function formulesAffichees(page: Page): Promise<string[]> {
  const entete = await page.getByText(/Question \d+ \/ \d+/).first().innerText();
  const total = Number(entete.match(/\/\s*(\d+)/)![1]);

  const trouvees: string[] = [];
  for (let i = 1; i <= total; i++) {
    await page.getByRole("button", { name: new RegExp(`^${i}$`) }).first().click();
    await expect(page.getByText(new RegExp(`Question ${i} / `))).toBeVisible();

    // La question est-elle à réponse courte ? Cela se lit sur l'écran, pas sur
    // la présence du champ : MathLive arrive dans un morceau chargé à la
    // demande, et sur un rechargement le premier champ peut mettre un moment à
    // exister. Chercher le champ d'abord faisait sauter la question — et une
    // réponse bien présente en base passait pour perdue.
    if (!(await page.getByText("Votre réponse :").isVisible().catch(() => false))) {
      continue;
    }
    const champ = page.locator("math-field");
    await expect(champ).toBeVisible();

    const echeance = Date.now() + 3_000;
    let valeur = "";
    for (;;) {
      valeur = await champ.evaluate((el: HTMLElement & { value: string }) => el.value);
      if (valeur !== "" || Date.now() > echeance) break;
      await page.waitForTimeout(100);
    }
    if (valeur) trouvees.push(valeur.replace(/\s/g, ""));
  }
  return trouvees;
}
