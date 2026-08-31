/**
 * Régression visuelle sur les écrans critiques.
 *
 * Les parcours vérifient que l'application fonctionne ; ils ne voient pas
 * qu'un écran s'est déformé. Une carte qui déborde, un tableau dont les
 * colonnes se chevauchent, une formule qui retombe en texte brut : rien de
 * cela ne fait échouer un test fonctionnel, et tout cela se voit le jour de
 * l'épreuve.
 *
 * Ces images sont comparées à des références **produites dans l'image Docker
 * de Playwright**, la même ici et sur la CI : sans cela, chaque poste
 * comparerait ses propres polices. Voir `npm run e2e:visuel`.
 *
 * Aucune référence n'est mise à jour automatiquement. Une différence doit être
 * regardée : soit c'est une régression, soit c'est un changement voulu qu'un
 * humain valide en régénérant l'image et en la relisant dans le diff.
 */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { test, ouvrir } from "./fixtures";

const EVALUATION_ID = 1;

/**
 * Fige ce qui bouge, pour que seule la mise en page soit comparée.
 *
 * L'heure, la durée restante et les dates changent à chaque exécution : les
 * laisser rendrait chaque image différente de la précédente, et la première
 * vraie régression passerait inaperçue au milieu du bruit.
 */
async function figerLaPage(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
      [data-visuel-instable] { visibility: hidden !important; }
    `,
  });
  // Les polices mathématiques arrivent après le premier rendu : comparer avant
  // leur chargement produirait une image différente à chaque fois.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

/** Une capture stable de la page entière. */
async function capturer(page: Page, nom: string, masques: string[] = []) {
  await figerLaPage(page);
  await expect(page).toHaveScreenshot(nom, {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    mask: masques.map((s) => page.locator(s)),
    maxDiffPixelRatio: 0.01,
  });
}

test.describe("écrans de l'élève", () => {
  test("l'accueil d'une évaluation", async ({ page }) => {
    await ouvrir(page, `/evaluation?eval=${EVALUATION_ID}&name=Visuel%20Accueil`);
    await expect(page.getByRole("button", { name: /Démarrer l'évaluation/ })).toBeVisible();
    await capturer(page, "eleve-accueil.png");
  });

  test("une question à choix multiples", async ({ page }) => {
    await ouvrir(page, `/evaluation?eval=${EVALUATION_ID}&name=Visuel%20QCM`);
    await page.getByRole("button", { name: /Démarrer l'évaluation/ }).click();
    await expect(page.getByText(/Question 1 \/ /)).toBeVisible();
    // Le minuteur descend à chaque seconde : c'est le seul élément masqué.
    await capturer(page, "eleve-question-qcm.png", ["[data-test=minuteur]"]);
  });

  test("une question à réponse courte, avec son champ mathématique", async ({ page }) => {
    await ouvrir(page, `/evaluation?eval=${EVALUATION_ID}&name=Visuel%20Math`);
    await page.getByRole("button", { name: /Démarrer l'évaluation/ }).click();
    for (let i = 0; i < 25; i += 1) {
      if (await page.getByText("Votre réponse :").isVisible().catch(() => false)) break;
      await page.getByRole("button", { name: /Suivant/ }).click();
      await page.waitForTimeout(120);
    }
    await expect(page.locator("math-field")).toBeVisible();
    await capturer(page, "eleve-question-math.png", ["[data-test=minuteur]"]);
  });
});

test.describe("écrans de l'enseignant", () => {
  test("le tableau de bord", async ({ enseignant: page }) => {
    await ouvrir(page, "/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await capturer(page, "enseignant-tableau-de-bord.png", ["[data-test=date]"]);
  });

  test("la liste des évaluations", async ({ enseignant: page }) => {
    await ouvrir(page, "/teacher/evaluations");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await capturer(page, "enseignant-liste-evaluations.png", ["[data-test=date]"]);
  });

  test("la grille de saisie d'un tirage papier", async ({ enseignant: page }) => {
    // L'écran où l'enseignant reporte des dizaines de cases : un décalage de
    // colonne y fausse un paquet de copies entier.
    await ouvrir(page, "/teacher/saisie/1");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await capturer(page, "enseignant-saisie-papier.png", ["[data-test=date]"]);
  });

  test("l'atelier de rédaction d'une évaluation", async ({ enseignant: page }) => {
    await ouvrir(page, `/teacher/evaluations/${EVALUATION_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".katex").first()).toBeVisible();
    await capturer(page, "enseignant-evaluation.png", ["[data-test=date]"]);
  });
});
