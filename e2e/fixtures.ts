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

/**
 * Les réglages de Gecko, partagés entre la configuration du projet et le
 * navigateur relancé pour chaque test : les deux doivent décrire le même
 * navigateur, sinon un test s'exécute ailleurs que là où il croit.
 */
export const PREFERENCES_GECKO = {
  "dom.ipc.processCount": 2,
  "browser.tabs.remote.autostart": true,
  "toolkit.telemetry.enabled": false,
  "app.update.enabled": false,
  "network.proxy.type": 0,
  "network.predictor.enabled": false,
  "network.dns.disablePrefetch": true,
  "browser.send_pings": false,
} as const;

export function cookieEnseignant(): string {
  if (cookieCache) return cookieCache;

  /*
    Fourni de l'extérieur quand les tests s'exécutent dans un conteneur.

    La régression visuelle tourne dans l'image de Playwright, qui n'a ni la
    configuration du serveur ni ses secrets : `dev-session.ts` y refuserait de
    démarrer. Le cookie est alors fabriqué par l'appelant, qui les a.
  */
  const fourni = process.env.E2E_COOKIE_ENSEIGNANT;
  if (fourni) {
    cookieCache = fourni;
    return cookieCache;
  }

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
      /*
        Chaque test commence en ligne.

        Le test de coupure réseau coupe la connexion et la rétablit. Sous Gecko,
        cet état déborde du contexte qui l'a posé : le test suivant héritait
        d'un navigateur hors ligne, et sa navigation expirait au bout de
        quatre-vingt-dix secondes — sur la CI, où l'ordre des fichiers les met
        côte à côte.
      */
      await page.context().setOffline(false);

      const anomalies = collecterErreurs(page);
      const tolerances: Array<{ motif: RegExp; raison: string }> = [];

      await use({
        tolerer(motif, raison) {
          tolerances.push({ motif, raison });
        },
      });

      /*
        Le test se termine, mais le navigateur, lui, n'a pas fini.

        Une copie en cours laisse derrière elle des requêtes en vol :
        l'enregistrement temporisé de deux secondes, le battement de présence,
        la file de reprise. Playwright ferme le contexte sans les attendre, et
        Gecko se retrouve à démonter des canaux réseau en cours d'usage. Une
        navigation sur trente n'était alors jamais émise — le journal d'accès du
        serveur le montre : il ne voyait rien arriver.

        On laisse donc le réseau se taire avant de rendre la main. Ce n'est pas
        une reprise : rien n'est rejoué, et un test qui échoue échoue toujours.
        C'est une fermeture propre, et elle vaut aussi pour l'application —
        fermer un onglet ne doit pas laisser une écriture à moitié partie.

        Le délai est court et l'échec est ignoré : si le réseau ne se tait pas,
        c'est au test de le dire, pas à la fixture.
      */
      await page
        .waitForLoadState("networkidle", { timeout: 5_000 })
        .catch(() => undefined);

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
 * Un nom d'élève qui n'a jamais servi.
 *
 * L'ouverture d'une session est plafonnée à cinq tentatives par minute pour un
 * même nom sur une même évaluation depuis une même adresse — la limite qui
 * borne une personne qui s'acharne. Les parcours employaient des noms fixes :
 * relancés plusieurs fois de suite, ils finissaient par mesurer ce plafond au
 * lieu du produit, et échouaient sur un écran qui ne s'affichait pas.
 *
 * Le suffixe est tiré au démarrage du processus de test : deux exécutions
 * successives ne se marchent plus dessus, et une exécution reste lisible.
 */
const SUFFIXE = `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
let compteur = 0;
export function nomEleve(prefixe: string): string {
  compteur += 1;
  return `${prefixe} ${SUFFIXE}-${compteur}`;
}

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

/**
 * Ouvre une page de l'application.
 *
 * On n'attend ni `load` ni le document analysé, mais la réponse.
 *
 * L'application est une page unique : `load` n'arrive qu'une fois tous les
 * morceaux chargés à la demande, les polices mathématiques comprises, et sous
 * Gecko il lui arrive de ne jamais arriver. `domcontentloaded` a tenu plus
 * longtemps, puis a lâché à son tour. `commit` ne dépend que du serveur : la
 * réponse a commencé à arriver. Tout le reste — le document, l'application,
 * l'écran —, chaque test l'affirme juste après, et c'est bien ce qu'il attend
 * vraiment.
 *
 * Aucune reprise. Une navigation qui n'est pas partie fait échouer le scénario
 * et produit ses diagnostics : c'est le seul moyen d'en trouver la cause.
 */
export async function ouvrir(page: Page, chemin: string): Promise<void> {
  await page.goto(chemin, { waitUntil: "commit" });
}
