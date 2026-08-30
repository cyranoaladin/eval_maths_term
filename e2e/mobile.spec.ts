/**
 * e2e/mobile.spec.ts
 *
 * Les élèves composent sur le matériel dont ils disposent, et un enseignant
 * qui saisit des copies le fait souvent une tablette à la main, à côté du tas
 * de papier. Ces tests vérifient que les écrans restent utilisables sur des
 * surfaces réduites.
 *
 * Ce qui est vérifié n'est pas « c'est joli » mais « c'est utilisable » :
 *
 *  - aucun débordement horizontal destructeur — une page qui défile
 *    latéralement fait disparaître des boutons hors de l'écran ;
 *  - les formules restent rendues et lisibles ;
 *  - le champ mathématique accepte la frappe ;
 *  - la navigation aboutit ;
 *  - les boutons critiques sont atteignables.
 *
 * Le débordement est mesuré sur `document.documentElement`, avec une tolérance
 * d'un pixel pour les arrondis de rendu. Un conteneur qui défile de lui-même —
 * un tableau large, un bloc de code — est légitime et n'est pas compté : c'est
 * le corps de page qui ne doit pas déborder.
 */
import { expect, type Page } from "@playwright/test";
import { collecterErreurs, cookieEnseignant, focaliserMath, test } from "./fixtures";

/** Surfaces réellement rencontrées, du téléphone à la tablette. */
const SURFACES = [
  { nom: "téléphone", largeur: 390, hauteur: 844 },   // iPhone 14
  { nom: "tablette", largeur: 820, hauteur: 1180 },   // iPad Air portrait
] as const;

/** Débordement horizontal du corps de page, en pixels. */
async function debordement(page: Page): Promise<number> {
  return page.evaluate(() => {
    const e = document.documentElement;
    return e.scrollWidth - e.clientWidth;
  });
}

/** Le premier élément qui dépasse la largeur de la fenêtre, s'il y en a un. */
async function coupable(page: Page): Promise<string> {
  return page.evaluate(() => {
    const largeur = document.documentElement.clientWidth;
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > largeur + 1) {
        // Un conteneur qui défile de lui-même est légitime.
        let p: Element | null = el;
        let scrollable = false;
        while (p && p !== document.body) {
          const s = getComputedStyle(p);
          if (s.overflowX === "auto" || s.overflowX === "scroll") { scrollable = true; break; }
          p = p.parentElement;
        }
        if (scrollable) continue;
        const chemin: string[] = [];
        let n: Element | null = el;
        for (let i = 0; n && i < 4; i++) {
          chemin.unshift(`${n.tagName.toLowerCase()}.${(n.className || "").toString().slice(0, 40)}`);
          n = n.parentElement;
        }
        return `${chemin.join(" > ")} [texte: ${(el.textContent || "").trim().slice(0, 40)}] → ${Math.round(r.right)}px pour ${largeur}px`;
      }
    }
    return "";
  });
}

for (const surface of SURFACES) {
  test.describe(`surface ${surface.nom} (${surface.largeur}×${surface.hauteur})`, () => {
    test.use({ viewport: { width: surface.largeur, height: surface.hauteur } });

    test("l'accueil et les pages légales tiennent dans l'écran", async ({ page }) => {
      const erreurs = collecterErreurs(page);
      for (const chemin of ["/", "/mentions-legales", "/confidentialite"]) {
        await page.goto(chemin);
        await expect(page.locator("body")).toBeVisible();
        expect(await debordement(page), `${chemin} : ${await coupable(page)}`).toBeLessThanOrEqual(1);
      }
      expect(erreurs, erreurs.join(" | ")).toEqual([]);
    });

    test("l'élève peut composer : formules lisibles, champ utilisable", async ({ page }) => {
      const erreurs = collecterErreurs(page);
      await page.goto(`/evaluation?eval=1&name=${encodeURIComponent(`Mobile ${surface.nom}`)}`);

      const demarrer = page.getByRole("button", { name: /Démarrer l'évaluation/ });
      await expect(demarrer).toBeVisible();
      expect(await debordement(page), `démarrage : ${await coupable(page)}`).toBeLessThanOrEqual(1);
      await demarrer.click();
      await expect(page.getByText(/Question 1 \/ /)).toBeVisible();

      expect(await debordement(page), `composition : ${await coupable(page)}`).toBeLessThanOrEqual(1);

      // Les formules doivent être rendues, pas affichées en LaTeX brut.
      const katex = page.locator(".katex").first();
      if (await katex.count()) {
        await expect(katex).toBeVisible();
        const boite = await katex.boundingBox();
        expect(boite?.height ?? 0, "formule de hauteur nulle").toBeGreaterThan(6);
      }

      // Navigation jusqu'à une réponse courte, puis frappe réelle.
      for (let i = 0; i < 25; i++) {
        if (await page.getByText("Votre réponse :").isVisible().catch(() => false)) break;
        await page.getByRole("button", { name: /Suivant/ }).click();
        await page.waitForTimeout(120);
      }
      const champ = page.locator("math-field");
      await expect(champ).toBeVisible();
      await focaliserMath(page);
      await page.keyboard.type("1/2");
      await expect
        .poll(() => champ.evaluate((el: HTMLElement & { value: string }) => el.value))
        .toMatch(/frac/);

      // Le clavier virtuel de MathLive ne doit pas repousser la page.
      expect(await debordement(page), `après saisie : ${await coupable(page)}`).toBeLessThanOrEqual(1);

      // Les commandes de navigation et de remise restent atteignables.
      await expect(page.getByRole("button", { name: /Précédent/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /Terminer/ }).first()).toBeVisible();

      expect(erreurs, erreurs.join(" | ")).toEqual([]);
    });
  });
}

/**
 * Les écrans enseignant visent la tablette au minimum. Un téléphone reste
 * possible pour consulter, mais corriger un paquet de copies sur 390 pixels de
 * large n'est pas un usage que ce produit prétend servir — la limitation est
 * assumée et documentée plutôt que mal traitée.
 */
test.describe("écrans enseignant sur tablette", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("le tableau de bord et la liste des évaluations sont exploitables", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({
      baseURL,
      viewport: { width: 820, height: 1180 },
    });
    await ctx.addCookies([{
      name: "kimi_sid",
      value: cookieEnseignant(),
      domain: new URL(baseURL!).hostname,
      path: "/",
    }]);
    const page = await ctx.newPage();
    const erreurs = collecterErreurs(page);

    for (const chemin of ["/dashboard", "/teacher/evaluations", "/preview"]) {
      await page.goto(chemin);
      await expect(page.locator("main").first()).toBeVisible();
      expect(await debordement(page), `${chemin} : ${await coupable(page)}`).toBeLessThanOrEqual(1);
    }

    // La navigation latérale doit rester ouvrable — sinon on ne circule plus.
    await page.goto("/dashboard");
    const bascule = page.getByRole("button", { name: /Afficher ou masquer la navigation/ });
    await expect(bascule).toBeVisible();

    /*
      L'écran de correction est celui qu'un enseignant tient réellement à la
      main, une tablette d'un côté et le paquet de copies de l'autre. C'est le
      minimum que ce produit prétend servir : sur un téléphone, corriger un
      paquet n'est pas un usage visé, et la limitation est assumée.
    */
    const lienCorriger = page.getByRole("link", { name: /Corriger/ }).first();
    if (await lienCorriger.count()) {
      await lienCorriger.click();
    } else {
      await page.goto("/teacher/correction/1");
    }
    await expect(page.locator("main").first()).toBeVisible();
    await page.waitForTimeout(600);
    expect(
      await debordement(page),
      `écran de correction : ${await coupable(page)}`,
    ).toBeLessThanOrEqual(1);

    // La saisie papier aussi : c'est l'autre écran tenu en main.
    await page.goto("/teacher/saisie/1");
    await expect(page.locator("main").first()).toBeVisible();
    await page.waitForTimeout(600);
    expect(
      await debordement(page),
      `saisie papier : ${await coupable(page)}`,
    ).toBeLessThanOrEqual(1);

    expect(erreurs, erreurs.join(" | ")).toEqual([]);
    await ctx.close();
  });
});
