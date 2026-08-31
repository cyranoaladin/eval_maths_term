/**
 * Rendu et saisie des mathématiques — critères 7 et 8.
 *
 * KaTeX et MathLive se comportent différemment selon le moteur : un rendu
 * correct sous Chromium ne dit rien de Safari. Ces tests s'exécutent sur les
 * trois moteurs.
 */
import { expect } from "@playwright/test";
import { collecterErreurs, test, ouvrir } from "./fixtures";

test.describe("ce que l'élève voit", () => {
  /*
    L'énoncé d'une copie, rendu — pas sa source.

    Ce cas manquait, et son absence a coûté cher : les écrans de l'enseignant
    rendaient les formules, ceux de l'élève affichaient la source LaTeX,
    dollars compris. Un contrôle de mathématiques entier était illisible pour
    ceux qui le passaient, et aucun test ne regardait cet écran-là.
  */
  test("l'énoncé et les propositions sont rendus, pas montrés en source", async ({ page }) => {
    const erreurs = collecterErreurs(page);
    // L'évaluation de référence à question unique : un QCM dont l'énoncé et
    // les quatre propositions portent des formules.
    await ouvrir(page, "/evaluation?eval=3&name=Rendu%20Eleve");
    await page.getByRole("button", { name: /Démarrer l'évaluation/ }).click();
    await expect(page.getByText(/Question 1 \/ 1/)).toBeVisible();

    // Deux formules dans l'énoncé — la fonction et la limite —, une par
    // proposition.
    await expect(page.locator(".katex")).toHaveCount(6, { timeout: 10_000 });

    const texte = await page.locator("main, body").first().innerText();
    expect(texte, "de la source LaTeX est restée à l'écran").not.toMatch(/\$\\?[a-zA-Z]/);

    // La source est conservée dans l'annotation MathML : c'est ce qui prouve
    // que la formule a été rendue et non recopiée.
    const sources = await page
      .locator('.katex annotation[encoding="application/x-tex"]')
      .allTextContents();
    expect(sources.join(" ")).toContain("\\dfrac");

    expect(erreurs, erreurs.join(" | ")).toEqual([]);
  });

  test("une réponse courte rend aussi son énoncé", async ({ page }) => {
    await ouvrir(page, "/evaluation?eval=4&name=Rendu%20Court");
    await page.getByRole("button", { name: /Démarrer l'évaluation/ }).click();
    await expect(page.locator("math-field")).toBeVisible();

    await expect(page.locator(".katex")).toHaveCount(1, { timeout: 10_000 });
    const texte = await page.locator("main, body").first().innerText();
    expect(texte).not.toMatch(/\$\\?[a-zA-Z]/);
  });
});

test.describe("rendu LaTeX", () => {
  test("l'éditeur affiche toutes les familles de formules sans erreur", async ({ enseignant: page }) => {
    const erreurs = collecterErreurs(page);

    await ouvrir(page, "/teacher/evaluations/1");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(1500);

    // KaTeX produit des éléments `.katex` : leur nombre mesure le rendu réel,
    // pas la simple présence du texte source.
    const formules = page.locator(".katex");
    const rendues = await formules.count();
    expect(rendues, "aucune formule rendue").toBeGreaterThan(20);

    // KaTeX conserve la source dans une annotation MathML : c'est le moyen
    // fiable de vérifier qu'une famille de formules a bien été rendue, plutôt
    // que de chercher un glyphe dont le codage dépend de la police.
    const annotations = await page
      .locator('.katex annotation[encoding="application/x-tex"]')
      .allTextContents();
    const source = annotations.join(" ");

    for (const famille of ["\\dfrac", "\\mathbb", "\\int", "_", "^"]) {
      expect(source, `famille ${famille} absente du rendu`).toContain(famille);
    }

    // Une formule non rendue laisserait sa source visible entre dollars.
    const texte = await page.locator("body").innerText();
    expect(texte, "du LaTeX brut est resté à l'écran").not.toMatch(/\$\\?[a-z]+\{/);

    expect(erreurs, erreurs.join(" | ")).toEqual([]);
  });

  test("une formule malformée ne fige pas la page", async ({ enseignant: page }) => {
    // Régression : un `$` non apparié faisait boucler le parseur à l'infini.
    const erreurs = collecterErreurs(page);
    await ouvrir(page, "/teacher/evaluations/1");
    await page.getByRole("button", { name: /Ajouter une question/ }).click();

    const enonce = page.locator("textarea").first();
    await enonce.fill("Soit $f(x)=\\dfrac{1}{x"); // délimiteur jamais fermé
    await page.waitForTimeout(1200);

    // La page répond encore : c'est tout ce qui compte.
    await expect(page.getByText("Aperçu élève")).toBeVisible({ timeout: 5000 });
    expect(erreurs.filter((e) => e.startsWith("pageerror"))).toEqual([]);
  });

  test("l'aperçu se met à jour à la frappe", async ({ enseignant: page }) => {
    await ouvrir(page, "/teacher/evaluations/1");
    await page.getByRole("button", { name: /Ajouter une question/ }).click();
    await page.locator("textarea").first().fill("Calculer $\\dfrac{3}{4} + \\dfrac{1}{4}$.");
    await page.waitForTimeout(900);

    const apercu = page.getByText("Aperçu élève").locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
    await expect(apercu.locator(".katex").first()).toBeVisible();
  });
});



test.describe("navigation", () => {
  test("les écrans enseignant s'enchaînent", async ({ enseignant: page }) => {
    const erreurs = collecterErreurs(page);

    await ouvrir(page, "/dashboard");
    await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();

    await ouvrir(page, "/teacher/evaluations");
    await expect(page.getByRole("heading", { name: "Mes évaluations" })).toBeVisible();

    await page.getByRole("link", { name: "Ouvrir" }).first().click();
    await expect(page.getByRole("button", { name: /Imprimer/ })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole("heading", { name: "Mes évaluations" })).toBeVisible({
      timeout: 20_000,
    });

    expect(erreurs, erreurs.join(" | ")).toEqual([]);
  });

  test("les pages légales sont accessibles depuis l'accueil", async ({ page }) => {
    const erreurs = collecterErreurs(page);
    await ouvrir(page, "/");
    await page.getByRole("link", { name: "Mentions légales" }).click();
    await expect(page.getByRole("heading", { name: "Mentions légales" })).toBeVisible();
    await ouvrir(page, "/confidentialite");
    await expect(page.getByRole("heading", { name: /Protection des données/ })).toBeVisible();
    expect(erreurs, erreurs.join(" | ")).toEqual([]);
  });
});
