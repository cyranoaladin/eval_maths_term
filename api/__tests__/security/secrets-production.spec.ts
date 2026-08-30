/**
 * Aucun secret ne vient du dépôt, et aucune valeur de remplissage ne passe en
 * production.
 *
 * `TEACHER_SESSION_SECRET` et `STUDENT_SESSION_SECRET` ont eu une valeur par
 * défaut publiée ici. Un déploiement qui oubliait de les définir démarrait
 * normalement, sans le moindre avertissement, et signait ses cookies enseignant
 * avec une chaîne lisible dans le code source : forger une session
 * d'administration ne demandait que de savoir cloner le projet. Ces valeurs de
 * repli n'existent plus — le schéma exige désormais les deux secrets, et
 * `scripts/bootstrap-dev.sh` en tire de nouveaux, propres à chaque machine.
 *
 * Reste le filet : un secret peut être renseigné et rester une plaisanterie.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifierSecretsDeProduction } from "../../lib/env";

/**
 * Entrées d'assertion : elles n'ouvrent rien, et tout leur intérêt est d'être
 * refusées. Les vraies valeurs de repli qui vivaient dans le code ont disparu
 * avec lui.
 */
const REMPLISSAGE_A = "dev_valeur_de_remplissage_assez_longue_pour_zod";
const REMPLISSAGE_B = "dev_autre_remplissage_assez_long_pour_le_schema";

const SOLIDE_A = "Zx8Qw2mR7pL4vN1sT6yU9bK3jH5gF0dC2aE8wQ4rY7uI";
const SOLIDE_B = "Mn4Kp7Rt2Vx9Zs5Wq8Ye3Ub6Ij1Od0Lc7Gh4Af2Nm5Pz";
const SOLIDE_C = "Qa1Ws2Ed3Rf4Tg5Yh6Uj7Ik8Ol9Pz0Xc1Vb2Nm3Lk4Jh";

function config(sur: Partial<Record<string, string>> = {}) {
  return {
    NODE_ENV: "production",
    TEACHER_SESSION_SECRET: SOLIDE_A,
    STUDENT_SESSION_SECRET: SOLIDE_B,
    APP_SECRET: SOLIDE_C,
    ...sur,
  };
}

describe("secrets de production", () => {
  it("accepte une configuration correctement renseignée", () => {
    expect(verifierSecretsDeProduction(config())).toEqual([]);
  });

  it("refuse un secret enseignant de développement", () => {
    const fautes = verifierSecretsDeProduction(
      config({ TEACHER_SESSION_SECRET: REMPLISSAGE_A }),
    );
    expect(fautes).toHaveLength(1);
    expect(fautes[0]).toMatch(/TEACHER_SESSION_SECRET/);
    expect(fautes[0]).toMatch(/remplissage/);
  });

  it("refuse un secret élève de développement", () => {
    const fautes = verifierSecretsDeProduction(
      config({ STUDENT_SESSION_SECRET: REMPLISSAGE_B }),
    );
    expect(fautes).toHaveLength(1);
    expect(fautes[0]).toMatch(/STUDENT_SESSION_SECRET/);
  });

  it("n'accepte plus aucune valeur de repli venue du code", () => {
    // La garde ne vaut que si le schéma n'a pas de porte de service : une
    // valeur par défaut réintroduite ici redeviendrait un secret public.
    const source = readFileSync(
      join(import.meta.dirname, "..", "..", "lib", "env.ts"),
      "utf8",
    );
    for (const nom of ["TEACHER_SESSION_SECRET", "STUDENT_SESSION_SECRET", "APP_SECRET"]) {
      const declaration = source
        .split("\n")
        .find((l) => l.trimStart().startsWith(`${nom}: z.`));
      expect(declaration, `${nom} introuvable dans le schéma`).toBeTruthy();
      expect(declaration, `${nom} a une valeur par défaut`).not.toMatch(/\.default\(/);
    }
  });

  it("refuse les valeurs de remplissage", () => {
    for (const remplissage of [
      "dev_quelque_chose_de_suffisamment_long_pour_zod",
      "change_me_please_but_long_enough_for_the_schema",
      "test_secret_assez_long_pour_passer_la_validation",
      "changeme",
    ]) {
      const fautes = verifierSecretsDeProduction(config({ APP_SECRET: remplissage }));
      expect(fautes.length, remplissage).toBeGreaterThan(0);
    }
  });

  it("refuse deux secrets identiques", () => {
    // Un jeton élève ne doit jamais pouvoir passer pour un jeton enseignant.
    const fautes = verifierSecretsDeProduction(
      config({ STUDENT_SESSION_SECRET: SOLIDE_A }),
    );
    expect(fautes.some((f) => /identiques/.test(f))).toBe(true);
  });

  it("refuse un secret d'application égal au secret enseignant", () => {
    const fautes = verifierSecretsDeProduction(config({ APP_SECRET: SOLIDE_A }));
    expect(fautes.some((f) => /identiques/.test(f))).toBe(true);
  });

  it("ne gêne pas le développement", () => {
    // Le contrôle ne s'applique qu'à la production : une machine de
    // développement peut porter ce qu'elle veut, elle n'expose rien.
    expect(
      verifierSecretsDeProduction({
        NODE_ENV: "development",
        TEACHER_SESSION_SECRET: REMPLISSAGE_A,
        STUDENT_SESSION_SECRET: REMPLISSAGE_B,
        APP_SECRET: "test-app-secret-min-32-chars-XXXXXXXXXXXXXXXXXX",
      }),
    ).toEqual([]);
  });

  it("ne gêne pas les tests", () => {
    expect(
      verifierSecretsDeProduction({
        NODE_ENV: "test",
        TEACHER_SESSION_SECRET: REMPLISSAGE_A,
        STUDENT_SESSION_SECRET: REMPLISSAGE_B,
        APP_SECRET: "test-app-secret",
      }),
    ).toEqual([]);
  });
});
