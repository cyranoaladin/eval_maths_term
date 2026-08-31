/**
 * Tests navigateur.
 *
 * Trois moteurs : les mathématiques sont rendues par KaTeX et saisies par
 * MathLive, deux bibliothèques dont le comportement dépend réellement du
 * moteur. Un rendu correct sous Chromium ne dit rien de Safari, et les élèves
 * composent sur le matériel dont ils disposent.
 *
 * Le serveur n'est pas démarré par Playwright : ces tests s'exécutent contre
 * une instance déjà en place, avec sa base et son jeu de données.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // les tests partagent la même base
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "fr-FR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /regression-visuelle\.spec\.ts/ },
    {
      name: "firefox",
      testIgnore: /regression-visuelle\.spec\.ts/,
      use: {
        ...devices["Desktop Firefox"],
        /*
          Un seul processus de contenu.
          
          Gecko se fermait au milieu d'une page sur les machines de la CI —
          « Target page, context or browser has been closed » —, et les tests
          suivants échouaient sur un navigateur mort. Les pages de cette
          application chargent KaTeX et MathLive ; multipliées par les processus
          que Firefox ouvre par défaut, elles dépassent ce dont dispose un
          runner. Ce n'est pas une instabilité du produit, et la masquer par une
          reprise l'aurait fait passer pour telle.
        */
        launchOptions: {
          firefoxUserPrefs: {
            "dom.ipc.processCount": 1,
            "browser.tabs.remote.autostart": false,
          },
        },
      },
    },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, testIgnore: /regression-visuelle\.spec\.ts/ },

    /*
      Régression visuelle.

      Un seul moteur et une seule taille : ce qu'on compare est la mise en page,
      pas le rendu de trois moteurs — celui-là est éprouvé par les parcours. La
      taille et le facteur d'échelle sont fixés, faute de quoi deux postes
      comparent deux images de dimensions différentes.

      Ce projet est exclu des exécutions ordinaires : les références sont
      produites dans l'image Docker de Playwright, la même ici et sur la CI.
    */
    {
      name: "visuel",
      testMatch: /regression-visuelle\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
  /* Les références vivent à côté des tests, pas dans un dossier par plateforme :
     elles sont produites dans un environnement unique et unique elles restent. */
  snapshotPathTemplate: "{testDir}/references-visuelles/{arg}{ext}",
});
