import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "src"),
      "@contracts": path.resolve(templateRoot, "contracts"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
      "@db": path.resolve(templateRoot, "db"),
      "db": path.resolve(templateRoot, "db"),
    },
  },
  test: {
    environment: "node",
    include: ["api/**/*.test.ts", "api/**/*.spec.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Monte le schéma de la base d'intégration avant tout test.
    globalSetup: ["./vitest.global-setup.ts"],
    // Les tests d'intégration partagent une base : les faire tourner en
    // parallèle produirait des interférences que personne ne saurait relire.
    // (Vitest 4 : `poolOptions.forks.singleFork` a été remplacé par cette
    // option de premier niveau, qui exécute les fichiers l'un après l'autre.)
    fileParallelism: false,
    /*
      Les tests d'intégration parlent à une vraie base : ouvrir une copie, la
      remettre, la corriger et relire le tout demande plusieurs dizaines
      d'allers-retours. Cinq secondes — le défaut, pensé pour des tests
      unitaires — sont trop justes dès que la machine exécute la suite entière.
      Vingt secondes laissent la place à ce travail réel sans rien masquer :
      un test réellement bloqué échoue toujours, un peu plus tard.
    */
    testTimeout: 20_000,
    /**
     * Seuils de couverture.
     *
     * Deux exigences, toutes deux sur les quatre métriques — instructions,
     * branches, fonctions, lignes : 95 % sur l'ensemble du serveur et des
     * contrats, 100 % sur les domaines où une erreur ne se rattrape pas.
     *
     * Aucune exclusion n'est posée pour arranger un chiffre, et aucune
     * directive d'ignorance n'existe dans le code : ce qui n'était atteignable
     * par rien a été supprimé plutôt que contourné. Les quelques gardes qui
     * restent inatteignables sont énumérées, une par une, dans
     * PRODUCTION_READINESS.md.
     */
    coverage: {
      provider: "v8",
      all: true,
      include: ["api/**/*.ts", "contracts/**/*.ts", "db/*.ts"],
      exclude: ["**/__tests__/**", "**/*.spec.ts", "**/*.test.ts"],
      thresholds: (() => {
        const complet = { lines: 100, statements: 100, functions: 100, branches: 100 };
        return {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 95,

          /* Le moteur de correction décide des notes. */
          "api/grading/**/*.ts": complet,

          /* La surveillance et la remise automatique décident d'une copie. */
          "api/anticheat/**/*.ts": complet,

          /* L'authentification et la session enseignant décident de qui entre. */
          "api/kimi/**/*.ts": complet,

          /* La propriété : ce qui empêche un enseignant d'atteindre les copies
             d'un collègue. */
          "api/queries/ownership.ts": complet,
          "api/queries/session-access.ts": complet,
          "api/queries/connection.ts": complet,

          /* Les gardes de sécurité posées sur chaque requête. */
          "api/lib/csrf.ts": complet,
          "api/lib/security-headers.ts": complet,
          "api/lib/cookies.ts": complet,
          "api/lib/base-url.ts": complet,
          "api/lib/rate-limit.ts": complet,

          /* La chaîne papier : ce qui est imprimé, et ce qui est saisi. */
          "api/paper/paper-service.ts": complet,
          "api/paper/manual-entry.ts": complet,
          "api/paper/amc-runner.ts": complet,
          "api/paper/parse-roster.ts": complet,
        };
      })(),
    },
  },
});
