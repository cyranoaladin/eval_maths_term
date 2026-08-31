/**
 * e2e/parcours-eleve.spec.ts
 *
 * Le parcours que vit réellement un élève : composer, être coupé du réseau,
 * revenir, recharger la page. Ce sont les trois façons dont une copie se perd,
 * et aucun test unitaire ne peut les observer — il faut un vrai navigateur, un
 * vrai IndexedDB et un vrai serveur.
 *
 * Les trois moteurs sont exercés : MathLive et KaTeX se comportent
 * différemment sous Gecko et WebKit, et les élèves composent sur le matériel
 * dont ils disposent.
 */
import { expect, type Page } from "@playwright/test";
import {
  brouillonsDuServeur,
  collecterErreurs,
  focaliserMath,
  formulesAffichees,
  test,
  ouvrir,
} from "./fixtures";

const EVALUATION_ID = 1;

/** Ouvre une session neuve et attend l'affichage de la première question. */
async function demarrer(page: Page, nom: string) {
  await ouvrir(page, `/evaluation?eval=${EVALUATION_ID}&name=${encodeURIComponent(nom)}`);
  // `session.start` est limité à 5 ouvertures par minute et par IP. Les trois
  // moteurs s'exécutent en série et n'atteignent pas ce quota ; si un 429
  // survenait, il doit faire échouer le test bruyamment plutôt qu'être absorbé
  // par une temporisation — c'est un signal produit, pas une gêne de test.
  const refus: string[] = [];
  page.on("response", (r) => {
    if (r.status() === 429) refus.push(r.url());
  });
  await page.getByRole("button", { name: /Démarrer l'évaluation/ }).click();
  await expect(page.getByText(/Question 1 \/ /)).toBeVisible();
  expect(refus, `quota atteint : ${refus.join(" ")}`).toEqual([]);
}

/** Avance jusqu'à la première question à réponse courte. */
async function allerAReponseCourte(page: Page): Promise<void> {
  for (let i = 0; i < 25; i++) {
    if (await page.getByText("Votre réponse :").isVisible().catch(() => false)) {
      return;
    }
    await page.getByRole("button", { name: /Suivant/ }).click();
    await page.waitForTimeout(150);
  }
  throw new Error("Aucune question à réponse courte trouvée");
}

/** Lit la formule effectivement détenue par le champ mathématique. */
function lireMath(page: Page): Promise<string> {
  return page
    .locator("math-field")
    .evaluate((el: HTMLElement & { value: string }) => el.value);
}

/**
 * Saisit une formule au clavier, comme le ferait un élève : MathLive convertit
 * les frappes ordinaires (« 1/2 » devient une fraction). On n'injecte pas de
 * LaTeX par l'API — ce que ce test doit prouver, c'est justement que la frappe
 * atteint React puis le serveur.
 */
async function saisirMath(page: Page, frappes: string, attendu: RegExp) {
  const champ = page.locator("math-field");
  await expect(champ).toBeVisible();
  await focaliserMath(page);
  await page.keyboard.type(frappes);
  await expect.poll(() => lireMath(page)).toMatch(attendu);
}

test.describe("parcours élève", () => {
  test("saisie mathématique, sauvegarde et reprise après rechargement", async ({
    page,
  }) => {
    const erreurs = collecterErreurs(page);
    await demarrer(page, "E2E Reprise");

    // Une question à choix multiple : la réponse la plus courante.
    const premiereOption = page.locator('[id^="q-"][id*="-opt-0"]').first();
    if (await premiereOption.isVisible().catch(() => false)) {
      await premiereOption.click();
    }

    await allerAReponseCourte(page);
    await saisirMath(page, "1/2", /frac/);

    /*
      Quitter la question envoie sans attendre ce qui vient d'être répondu : la
      temporisation de l'enregistrement automatique ne survit pas au changement
      de question. Attendre « Sauvegardé » ne suffirait pas — cet indicateur ne
      dit pas *quel* brouillon est parti, et il peut refléter la réponse au QCM
      précédent.
    */
    await page.getByRole("button", { name: /Suivant/ }).click();
    await expect(page.getByText("Sauvegardé", { exact: true })).toBeVisible({ timeout: 20_000 });

    // Rechargement : c'est ici que la copie se perdait tant que le jeton ne
    // vivait qu'en mémoire.
    await page.reload();

    // La session reprend sans repasser par l'écran de démarrage.
    await expect(page.getByText(/Question 1 \/ /)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Démarrer l'évaluation/ }),
    ).toHaveCount(0);

    // Et le brouillon est bien revenu du serveur.
    await allerAReponseCourte(page);
    await expect.poll(() => lireMath(page)).toMatch(/frac/);

    expect(erreurs, `erreurs console : ${erreurs.join(" | ")}`).toEqual([]);
  });

  test("une frappe rapide n'est pas rognée par la synchronisation", async ({
    page,
  }) => {
    /*
      Le champ mathématique est contrôlé par React : sa valeur remonte à chaque
      frappe et redescend au rendu suivant. Ce rendu arrive avec un temps de
      retard, et la synchronisation constatait alors un écart avec ce que
      l'élève avait déjà tapé entre-temps — puis réécrivait le champ, effaçant
      les caractères frappés depuis. La réponse se rétractait sous ses doigts,
      d'autant plus qu'il composait vite.

      Ce test frappe sans temporisation, comme un élève pressé en fin d'épreuve,
      et compare caractère par caractère.
    */
    const erreurs = collecterErreurs(page);
    await demarrer(page, "E2E Frappe rapide");
    await allerAReponseCourte(page);

    const champ = page.locator("math-field");
    for (const [frappes, attendu] of [
      ["2x+3-5", "2x+3-5"],
      ["3*x^2+1", "3\\cdot x^2+1"],
    ] as const) {
      await champ.evaluate((el: HTMLElement & { setValue?: (v: string) => void }) =>
        el.setValue?.(""),
      );
      await focaliserMath(page);
      await page.keyboard.type(frappes);
      await expect
        .poll(() => lireMath(page), { message: `frappe « ${frappes} » rognée` })
        .toBe(attendu);
    }

    expect(erreurs, erreurs.join(" | ")).toEqual([]);
  });

  test("changer de question aussitôt après avoir répondu ne perd pas la réponse", async ({
    page,
  }) => {
    /*
      L'enregistrement automatique attend deux secondes de silence avant
      d'envoyer. Cette temporisation était unique et partagée : programmer
      l'envoi d'une question annulait celui de la précédente. Un élève qui
      répondait puis passait à la suivante en moins de deux secondes — le rythme
      normal d'un QCM — perdait sa réponse sans le savoir : ni envoyée, ni mise
      en file locale, elle n'existait plus qu'à l'écran.

      Ce test ne laisse aucun répit entre les deux réponses, puis recharge la
      page : ce qui revient est ce que le serveur détient réellement.
    */
    const erreurs = collecterErreurs(page);
    await demarrer(page, "E2E Enchainement");

    await allerAReponseCourte(page);
    await saisirMath(page, "x^2", /x\^2/);

    // Aussitôt : pas d'attente, pas de « Sauvegardé » guetté.
    await page.getByRole("button", { name: /Suivant/ }).click();
    await allerAReponseCourte(page);
    await saisirMath(page, "3x+1", /3x\+1/);

    await expect(page.getByText("Sauvegardé", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    // Les deux temporisations doivent avoir vécu leur vie.
    await page.waitForTimeout(3_000);

    await page.reload();
    await expect(page.getByText(/Question 1 \/ /)).toBeVisible();

    const trouves = await formulesAffichees(page);

    const etat = `écran : ${trouves.join(" , ") || "(rien)"} — serveur : ${await brouillonsDuServeur(page)}`;
    expect(
      trouves.some((v) => v.includes("x^2")),
      `la réponse quittée aussitôt est perdue — ${etat}`,
    ).toBe(true);
    expect(trouves.some((v) => v.includes("3x+1")), etat).toBe(true);

    expect(erreurs, erreurs.join(" | ")).toEqual([]);
  });

  test("un rechargement sur réseau lent n'annonce pas une épreuve terminée", async ({
    page,
  }) => {
    /*
      Le minuteur démarrait avant de connaître la durée de l'épreuve. Or celle-ci
      vaut zéro le temps qu'elle revienne du serveur, et un minuteur de zéro
      seconde est un minuteur déjà écoulé : l'élève voyait 00:00 sur bandeau
      rouge — l'affichage de la dernière minute — au moment précis où il
      reprenait sa copie après un rechargement. Le minuteur déclenchait aussi,
      dans cet état, la remise automatique pour temps dépassé.

      En local, la durée revient en vingt millisecondes et rien ne se voyait.
      Sur le réseau d'un établissement, elle met plus d'une seconde. Ce test
      retarde délibérément cette seule requête et regarde ce que l'élève voit
      pendant ce temps-là — une assertion posée après coup ne verrait rien,
      puisque tout se remet en ordre dès que la durée arrive.
    */
    const erreurs = collecterErreurs(page);
    await demarrer(page, "E2E Réseau lent");

    await page.route(/question\.getPublicInfo/, async (route) => {
      await new Promise((suite) => setTimeout(suite, 4_000));
      await route.continue();
    });
    await page.reload({ waitUntil: "commit" });

    const vus: string[] = [];
    const urls = new Set<string>();
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(250);
      const etat = await page
        .evaluate(() => {
          const badge = document.querySelector(".sticky .inline-flex");
          const barre = document.querySelector(".sticky.top-0") as HTMLElement | null;
          return {
            url: location.pathname,
            minuteur: badge?.textContent?.trim() ?? "",
            fond: barre ? getComputedStyle(barre).backgroundColor : "",
          };
        })
        .catch(() => ({ url: "", minuteur: "", fond: "" }));
      urls.add(etat.url);
      if (etat.minuteur) vus.push(`${etat.minuteur} sur ${etat.fond}`);
      if (vus.length >= 3) break;
    }

    expect(vus.length, "le minuteur doit finir par s'afficher").toBeGreaterThan(0);
    expect(
      vus.filter((v) => v.startsWith("00:00")),
      `l'élève a vu son épreuve annoncée terminée : ${vus.join(" | ")}`,
    ).toEqual([]);
    expect(
      [...urls].filter((u) => u.includes("results")),
      "la copie ne doit pas être remise toute seule",
    ).toEqual([]);

    await page.unroute(/question\.getPublicInfo/);
    expect(erreurs, erreurs.join(" | ")).toEqual([]);
  });

  test("coupure réseau de 30 secondes sans perte de copie", async ({
    page,
    context,
    surveillance,
  }) => {
    /*
      Ce que le navigateur a le droit de dire pendant la coupure.

      Les polices mathématiques sont chargées à la demande, quand une formule
      a besoin d'un glyphe qu'elles seules portent. Une question atteinte hors
      ligne en demande une, et le navigateur signale qu'il n'a pas pu la
      chercher — chaque moteur à sa façon : « ERR_INTERNET_DISCONNECTED » sous
      Chromium, « WebKit encountered an internal error » sous Safari. La formule
      s'affiche alors dans une police de repli : c'est une dégradation
      d'apparence, pas une copie perdue — et c'est précisément ce que ce test
      vérifie ensuite.

      La tolérance ne vaut que pour ce test-là : ailleurs, un échec de
      chargement reste une anomalie.
    */
    surveillance.tolerer(
      /Failed to load resource/,
      "le réseau est coupé volontairement : les polices demandées à cet instant ne peuvent pas arriver",
    );

    await demarrer(page, "E2E Coupure");
    await allerAReponseCourte(page);
    await saisirMath(page, "x^2", /x\^2/);
    await expect(page.getByText("Sauvegardé", { exact: true })).toBeVisible({ timeout: 20_000 });

    // ── Coupure réelle du réseau ──
    await context.setOffline(true);

    await page.getByRole("button", { name: /Suivant/ }).click();
    await allerAReponseCourte(page);
    await saisirMath(page, "3x+1", /3x\+1/);

    // La sauvegarde bascule sur IndexedDB et l'élève en est informé.
    await expect(page.getByText(/Hors-ligne/)).toBeVisible({ timeout: 20_000 });

    // On maintient la composition hors ligne : c'est la durée d'une vraie
    // micro-coupure de wifi en salle.
    const debut = Date.now();
    await page.waitForTimeout(30_000);
    expect(Date.now() - debut).toBeGreaterThanOrEqual(30_000);

    // La page a continué de fonctionner pendant la coupure.
    await expect(page.getByText(/Question \d+ \/ /)).toBeVisible();

    // ── Rétablissement ──
    await context.setOffline(false);

    // La file IndexedDB est rejouée toutes les 5 s.
    await expect(page.getByText("Sauvegardé", { exact: true })).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText(/en attente/)).toHaveCount(0, { timeout: 40_000 });

    // Vérification décisive : le serveur détient bien ce qui a été écrit
    // pendant la coupure — le rechargement le relit.
    await page.reload();
    await expect(page.getByText(/Question 1 \/ /)).toBeVisible();

    /*
      Les brouillons arrivent du serveur après le rendu, et le champ n'existe
      lui-même qu'une fois MathLive chargé. Lire immédiatement reviendrait à
      constater un vide qui n'a pas encore eu le temps d'être rempli — et à
      accuser le produit d'une perte qui n'en est pas une. On laisse donc à
      chaque champ un délai borné pour recevoir sa valeur ; passé ce délai, il
      est vraiment vide.
    */
    const trouves = await formulesAffichees(page);

    const cote = `écran : ${trouves.join(" , ") || "(rien)"} — serveur : ${await brouillonsDuServeur(page)}`;
    expect(
      trouves.some((v) => v.includes("x^2")),
      `la réponse écrite avant la coupure est perdue — ${cote}`,
    ).toBe(true);
    expect(
      trouves.some((v) => v.includes("3x+1")),
      `la réponse écrite hors ligne est perdue — ${cote}`,
    ).toBe(true);

    // La copie est remise depuis l'état restauré : ce sont donc bien les
    // réponses écrites pendant la coupure qui partent au serveur.
    await page.getByRole("button", { name: /Terminer/ }).first().click();
    const dialogue = page.getByRole("dialog");
    await expect(dialogue).toContainText(/Vous avez répondu à \d+ question/);
    const repondues = Number(
      (await dialogue.innerText()).match(/répondu à (\d+) question/)![1],
    );
    expect(
      repondues,
      "les brouillons restaurés doivent alimenter la remise",
    ).toBeGreaterThanOrEqual(2);

    await dialogue.getByRole("button", { name: /Confirmer et soumettre/ }).click();
    await expect(page).toHaveURL(/\/results\?token=/);

    // Le jeton d'une copie remise ne doit plus traîner dans l'onglet : sans ce
    // nettoyage, un simple retour en arrière rouvrirait l'écran de composition.
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem("session-eleve")))
      .toBeFalsy();
  });

  test("navigation avant et arrière sans perte de saisie", async ({ page }) => {
    const erreurs = collecterErreurs(page);
    await demarrer(page, "E2E Navigation");
    await allerAReponseCourte(page);

    const titreQuestion = await page.getByText(/Question \d+ \/ /).innerText();
    await saisirMath(page, "1/2", /frac/);

    await page.getByRole("button", { name: /Suivant/ }).click();
    await expect(page.getByText(/Question \d+ \/ /)).not.toHaveText(titreQuestion);
    await page.getByRole("button", { name: /Précédent/ }).click();
    await expect(page.getByText(/Question \d+ \/ /)).toHaveText(titreQuestion);

    await expect.poll(() => lireMath(page)).toMatch(/frac/);

    // Le bouton Précédent est bien neutralisé sur la première question.
    for (let i = 0; i < 25; i++) {
      const prec = page.getByRole("button", { name: /Précédent/ });
      if (await prec.isDisabled()) break;
      await prec.click();
      await page.waitForTimeout(100);
    }
    await expect(page.getByText(/Question 1 \/ /)).toBeVisible();
    await expect(page.getByRole("button", { name: /Précédent/ })).toBeDisabled();

    expect(erreurs, `erreurs console : ${erreurs.join(" | ")}`).toEqual([]);
  });
});
