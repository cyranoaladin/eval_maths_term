/**
 * e2e/accessibilite.spec.ts
 *
 * Ce que l'application impose à quelqu'un qui ne voit pas l'écran, ou qui ne
 * tient pas de souris.
 *
 * Un élève ne choisit pas son matériel ni ses capacités, et une épreuve ne se
 * repasse pas. Un contraste illisible ou un champ sans étiquette n'est pas un
 * défaut de confort : c'est une copie qu'on ne peut pas rendre.
 *
 * Le seuil retenu est « aucune violation critique, aucune violation sérieuse »
 * — les deux niveaux qu'axe réserve à ce qui empêche réellement d'utiliser une
 * page. Les niveaux inférieurs sont rapportés dans le message d'échec quand il
 * y en a un, sans faire échouer.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { cookieEnseignant, test, ouvrir } from "./fixtures";

const BLOQUANTS = ["critical", "serious"] as const;

const NORMES = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Analyse la page et échoue sur les violations bloquantes.
 *
 * Deux passes, pour une seule raison. `<math-field>` est un élément focusable
 * qui contient un puits de saisie lui-même focusable : axe y voit des contrôles
 * imbriqués, et c'est exact. C'est aussi la façon dont MathLive est construit —
 * la même pour tout éditeur de formules —, et nous n'y pouvons rien sans le
 * réécrire. Plutôt que de désactiver la règle partout, ou d'exclure le champ de
 * tout examen, on examine le reste de la page avec la règle, et le champ avec
 * toutes les autres.
 */
async function auditer(page: Page, ecran: string) {
  /*
    On laisse les animations finir. axe mesure les couleurs telles qu'elles sont
    à l'instant de l'analyse : un bouton saisi au milieu de son fondu d'entrée
    est à demi transparent, et son contraste calculé sur un gris qui n'existe
    qu'un dixième de seconde. Ce n'est pas ce qu'on veut mesurer.
  */
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== "running"),
    undefined,
    { timeout: 5_000 },
  );

  const horsChamp = await new AxeBuilder({ page })
    .withTags(NORMES)
    .exclude("math-field")
    .analyze();

  const champ =
    (await page.locator("math-field").count()) > 0
      ? await new AxeBuilder({ page })
          .withTags(NORMES)
          .include("math-field")
          .disableRules(["nested-interactive"])
          .analyze()
      : { violations: [] };

  const bloquantes = [...horsChamp.violations, ...champ.violations].filter((v) =>
    BLOQUANTS.includes(v.impact as (typeof BLOQUANTS)[number]),
  );

  const detail = bloquantes
    .map(
      (v) =>
        `  [${v.impact}] ${v.id} — ${v.help}\n` +
        v.nodes
          .slice(0, 3)
          .map((n) => `      ${n.target.join(" ")}\n      ${n.failureSummary?.split("\n").join(" ")}`)
          .join("\n"),
    )
    .join("\n");

  expect(bloquantes, `${ecran} :\n${detail}`).toEqual([]);
}

test.describe("accessibilité — élève", () => {
  test("l'accueil et les pages légales", async ({ page }) => {
    for (const [chemin, nom] of [
      ["/", "accueil"],
      ["/mentions-legales", "mentions légales"],
      ["/confidentialite", "confidentialité"],
    ] as const) {
      await ouvrir(page, chemin);
      await expect(page.locator("main, body").first()).toBeVisible();
      await auditer(page, nom);
    }
  });

  test("l'écran de démarrage puis la composition", async ({ page }) => {
    await ouvrir(page, `/evaluation?eval=1&name=${encodeURIComponent("A11y Élève")}`);
    await expect(page.getByRole("button", { name: /Démarrer l'évaluation/ })).toBeVisible();
    await auditer(page, "démarrage d'une épreuve");

    await page.getByRole("button", { name: /Démarrer l'évaluation/ }).click();
    await expect(page.getByText(/Question 1 \/ /)).toBeVisible();
    await auditer(page, "composition — première question");

    /*
      L'ordre des questions est mélangé par session : auditer la première ne dit
      rien du champ mathématique, qui n'y apparaît qu'une fois sur deux. On va
      donc explicitement jusqu'à une réponse courte — c'est l'écran le plus
      délicat, et celui qu'un élève passe le plus de temps à regarder.
    */
    for (let i = 0; i < 25; i++) {
      if (await page.getByText("Votre réponse :").isVisible().catch(() => false)) break;
      await page.getByRole("button", { name: /Suivant/ }).click();
      await page.waitForTimeout(150);
    }
    await expect(page.locator("math-field")).toBeVisible();
    await auditer(page, "composition — champ mathématique");
  });

  test("l'élève compose au clavier seul, sans jamais toucher la souris", async ({
    page,
  }) => {
    /*
      Un élève qui ne peut pas utiliser de souris doit pouvoir démarrer,
      répondre et naviguer. La tabulation doit atteindre chaque commande, et le
      focus doit rester visible — sinon on ne sait plus où l'on est.
    */
    await ouvrir(page, `/evaluation?eval=1&name=${encodeURIComponent("A11y Clavier")}`);

    const demarrer = page.getByRole("button", { name: /Démarrer l'évaluation/ });
    await expect(demarrer).toBeVisible();

    // Atteindre le bouton par la seule tabulation.
    let atteint = false;
    for (let i = 0; i < 30 && !atteint; i++) {
      await page.keyboard.press("Tab");
      atteint = await demarrer.evaluate((el) => el === document.activeElement);
    }
    expect(atteint, "« Démarrer » doit être atteignable au clavier").toBe(true);

    // Le focus se voit.
    const contour = await demarrer.evaluate((el) => {
      const s = getComputedStyle(el);
      return { outline: s.outlineStyle, largeur: s.outlineWidth, ombre: s.boxShadow };
    });
    expect(
      contour.outline !== "none" || contour.ombre !== "none",
      "le focus doit rester visible",
    ).toBe(true);

    await page.keyboard.press("Enter");
    await expect(page.getByText(/Question 1 \/ /)).toBeVisible();

    // Répondre à un QCM au clavier : atteindre une proposition, la choisir.
    const option = page.locator('[id^="q-"][id*="-opt-0"]').first();
    if (await option.count()) {
      let surOption = false;
      for (let i = 0; i < 40 && !surOption; i++) {
        await page.keyboard.press("Tab");
        surOption = await option.evaluate((el) => el === document.activeElement);
      }
      expect(surOption, "une proposition doit être atteignable au clavier").toBe(true);
      await page.keyboard.press("Space");
      await expect(option).toBeChecked();
    }

    // Et passer à la question suivante.
    const suivant = page.getByRole("button", { name: /Suivant/ });
    let surSuivant = false;
    for (let i = 0; i < 40 && !surSuivant; i++) {
      await page.keyboard.press("Tab");
      surSuivant = await suivant.evaluate((el) => el === document.activeElement);
    }
    expect(surSuivant, "« Suivant » doit être atteignable au clavier").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Question 2 \/ /)).toBeVisible();
  });
});

test.describe("accessibilité — enseignant", () => {
  test.use({
    storageState: undefined,
  });

  test("les écrans de travail", async ({ browser, baseURL }) => {
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

    for (const [chemin, nom] of [
      ["/dashboard", "tableau de bord"],
      ["/teacher/evaluations", "mes évaluations"],
      ["/preview", "aperçu"],
      ["/teacher/saisie/1", "saisie papier"],
      ["/teacher/correction/1", "correction"],
    ] as const) {
      await ouvrir(page, chemin);
      await expect(page.locator("main").first()).toBeVisible();
      await auditer(page, nom);
    }

    await ctx.close();
  });

  test("la navigation latérale s'ouvre et se parcourt au clavier", async ({
    browser,
    baseURL,
  }) => {
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
    await ouvrir(page, "/dashboard");
    // Le tableau de bord charge ses données avant de rendre sa navigation.
    await expect(page.locator("main").first()).toBeVisible();

    const bascule = page.getByRole("button", { name: /Afficher ou masquer la navigation/ });
    await expect(bascule).toBeVisible();

    let atteint = false;
    for (let i = 0; i < 20 && !atteint; i++) {
      await page.keyboard.press("Tab");
      atteint = await bascule.evaluate((el) => el === document.activeElement);
    }
    expect(atteint, "la bascule de navigation doit être atteignable au clavier").toBe(true);

    await page.keyboard.press("Enter");
    // Une entrée de menu doit rester atteignable après la bascule.
    await expect(page.getByRole("button", { name: /Mes évaluations/ })).toBeVisible();

    await ctx.close();
  });
});
