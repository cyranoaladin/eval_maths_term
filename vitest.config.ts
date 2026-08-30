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
    /**
     * Seuils de couverture — critère 12 de PLAN.md.
     *
     * Le texte dit « ≥ 80 % global, 100 % sur api/grading ». Il ne nomme pas
     * de métrique : on retient la lecture la plus stricte, c'est-à-dire les
     * quatre. Aucune exclusion n'est posée pour arranger le chiffre ; le code
     * qui n'était atteignable par rien a été supprimé plutôt que contourné.
     */
    coverage: {
      provider: "v8",
      all: true,
      include: ["api/**/*.ts", "contracts/**/*.ts", "db/*.ts"],
      exclude: ["**/__tests__/**", "**/*.spec.ts", "**/*.test.ts"],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
        // Le moteur de correction décide des notes : rien n'y reste inexploré.
        "api/grading/**/*.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
      },
    },
  },
});
