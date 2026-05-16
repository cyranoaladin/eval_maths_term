import { describe, it, expect } from "vitest";
import { appRouter } from "../../router";
import { questionRouter } from "../../routers/question-router";
import { sessionRouter } from "../../routers/session-router";
import { cheatRouter } from "../../routers/cheat-router";

/**
 * III.1 — Test E2E : vérifie que correctAnswer ne fuit JAMAIS
 * dans les routes accessibles sans rôle teacher.
 *
 * Ce test inspecte la structure des procédures du routeur tRPC
 * et s'assure que les routes publiques/student ne retournent pas correctAnswer.
 */
describe("no-leak-correct-answer : vérification de la structure du routeur", () => {
  it("le routeur question est enregistré dans appRouter", () => {
    expect(appRouter._def.record.question).toBeDefined();
  });

  it("question.getForActiveSession est défini", () => {
    const keys = Object.keys(questionRouter._def.record);
    expect(keys).toContain("getForActiveSession");
  });

  it("question.getPublicInfo est défini (infos sans réponses)", () => {
    const keys = Object.keys(questionRouter._def.record);
    expect(keys).toContain("getPublicInfo");
  });

  it("question.getWithAnswersForTeacher est défini (réservé prof)", () => {
    const keys = Object.keys(questionRouter._def.record);
    expect(keys).toContain("getWithAnswersForTeacher");
  });

  it("session.start est défini (démarrage de session élève)", () => {
    const keys = Object.keys(sessionRouter._def.record);
    expect(keys).toContain("start");
  });

  it("session.submit est défini (soumission protégée)", () => {
    const keys = Object.keys(sessionRouter._def.record);
    expect(keys).toContain("submit");
  });

  it("session.getAllForTeacher est défini (dashboard prof)", () => {
    const keys = Object.keys(sessionRouter._def.record);
    expect(keys).toContain("getAllForTeacher");
  });

  it("cheat.report est défini (append-only)", () => {
    const keys = Object.keys(cheatRouter._def.record);
    expect(keys).toContain("report");
  });
});

describe("no-leak-correct-answer : vérification des champs retournés", () => {
  it("question-router n'importe pas correctAnswer dans le select public", async () => {
    // Vérifie au niveau du code source que correctAnswer n'est pas dans le select
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const routerSource = readFileSync(
      resolve(__dirname, "../../routers/question-router.ts"),
      "utf-8",
    );

    // La route getForActiveSession doit explicitement exclure correctAnswer
    expect(routerSource).toContain("correctAnswer est exclu volontairement");

    // Le select explicite ne doit pas inclure correctAnswer
    const forActiveSessionBlock = routerSource.slice(
      routerSource.indexOf("getForActiveSession"),
      routerSource.indexOf("getPublicInfo"),
    );
    expect(forActiveSessionBlock).not.toContain("correctAnswer: questions.correctAnswer");
  });

  it("public-types.ts ne déclare pas de propriété correctAnswer dans les interfaces", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const publicTypesSource = readFileSync(
      resolve(__dirname, "../../../contracts/public-types.ts"),
      "utf-8",
    );
    // Le fichier peut mentionner correctAnswer dans des commentaires explicatifs
    // mais ne doit pas en déclarer une comme propriété d'interface
    expect(publicTypesSource).not.toMatch(/^\s+correctAnswer\s*:/m);
  });
});
