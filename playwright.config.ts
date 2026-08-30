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
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
