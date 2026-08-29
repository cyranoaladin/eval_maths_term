/**
 * Un serveur de production ne doit pas pouvoir démarrer avec les secrets du
 * dépôt.
 *
 * `TEACHER_SESSION_SECRET` et `STUDENT_SESSION_SECRET` avaient une valeur par
 * défaut, publiée dans ce dépôt. Un déploiement qui oubliait de les définir
 * démarrait normalement, sans le moindre avertissement, et signait ses cookies
 * enseignant avec une chaîne que n'importe qui peut lire dans le code source :
 * forger une session d'administration ne demandait que de savoir cloner le
 * projet.
 */
import { describe, it, expect } from "vitest";
import { verifierSecretsDeProduction } from "../../lib/env";

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

  it("refuse le secret enseignant de développement", () => {
    const fautes = verifierSecretsDeProduction(
      config({ TEACHER_SESSION_SECRET: "dev_teacher_secret_change_in_production_at_least_32" }),
    );
    expect(fautes).toHaveLength(1);
    expect(fautes[0]).toMatch(/TEACHER_SESSION_SECRET/);
    expect(fautes[0]).toMatch(/forger une session/);
  });

  it("refuse le secret élève de développement", () => {
    const fautes = verifierSecretsDeProduction(
      config({ STUDENT_SESSION_SECRET: "dev_student_secret_change_in_production_at_least_32" }),
    );
    expect(fautes).toHaveLength(1);
    expect(fautes[0]).toMatch(/STUDENT_SESSION_SECRET/);
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
    // Sans repli utilisable, aucune machine de développement ne démarrerait
    // sans configuration : ce serait payer la sécurité de la production par
    // l'inutilisabilité du poste de travail.
    expect(
      verifierSecretsDeProduction({
        NODE_ENV: "development",
        TEACHER_SESSION_SECRET: "dev_teacher_secret_change_in_production_at_least_32",
        STUDENT_SESSION_SECRET: "dev_student_secret_change_in_production_at_least_32",
        APP_SECRET: "test-app-secret-min-32-chars-XXXXXXXXXXXXXXXXXX",
      }),
    ).toEqual([]);
  });

  it("ne gêne pas les tests", () => {
    expect(
      verifierSecretsDeProduction({
        NODE_ENV: "test",
        TEACHER_SESSION_SECRET: "dev_teacher_secret_change_in_production_at_least_32",
        STUDENT_SESSION_SECRET: "dev_student_secret_change_in_production_at_least_32",
        APP_SECRET: "test-app-secret",
      }),
    ).toEqual([]);
  });
});
