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
import { test, expect, type Page } from "@playwright/test";
import { collecterErreurs, focaliserMath } from "./fixtures";

const EVALUATION_ID = 1;

/** Ouvre une session neuve et attend l'affichage de la première question. */
async function demarrer(page: Page, nom: string) {
  await page.goto(
    `/evaluation?eval=${EVALUATION_ID}&name=${encodeURIComponent(nom)}`,
  );
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

    // Le debounce d'auto-save est de 2 s ; on attend la confirmation visible.
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

  test("coupure réseau de 30 secondes sans perte de copie", async ({ page, context }) => {
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

    const trouves: string[] = [];
    for (let i = 0; i < 25; i++) {
      const champ = page.locator("math-field");
      if (await champ.isVisible().catch(() => false)) {
        const v = await lireMath(page);
        if (v) trouves.push(v.replace(/\s/g, ""));
      }
      const suivant = page.getByRole("button", { name: /Suivant/ });
      if (!(await suivant.isVisible().catch(() => false))) break;
      await suivant.click();
      await page.waitForTimeout(120);
    }

    expect(
      trouves.some((v) => v.includes("x^2")),
      `réponses retrouvées : ${trouves.join(" , ")}`,
    ).toBe(true);
    expect(
      trouves.some((v) => v.includes("3x+1")),
      `la réponse écrite hors ligne est perdue — retrouvées : ${trouves.join(" , ")}`,
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
