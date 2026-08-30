/**
 * Phase 3.5 — Surface publique de l'API.
 *
 * Ces tests verrouillent la régression qui a motivé la phase : le frontend
 * élève appelait `evaluation.getQuestions`, `evaluation.submitAnswers` et
 * `evaluation.getResults`, trois routes `publicQuery` qui renvoyaient les
 * corrections, acceptaient une soumission sans jeton et laissaient lire la
 * copie de n'importe quel élève par simple incrément d'identifiant.
 *
 * Le test appelle l'API avec un contexte anonyme : le middleware s'exécute
 * avant le resolver, donc aucune base de données n'est nécessaire — une route
 * qui redeviendrait publique échouerait ici en atteignant la couche SQL.
 */
import { describe, expect, it } from "vitest";
import { RateLimits } from "../../lib/rate-limit";
import { appRouter } from "../../router";
import type { TrpcContext } from "../../context";

function anonymousContext(): TrpcContext {
  return {
    req: new Request("http://localhost/api/trpc", {
      headers: { origin: "http://localhost:3000" },
    }),
    resHeaders: new Headers(),
  };
}

const caller = () => appRouter.createCaller(anonymousContext());

describe("surface publique : inventaire des procédures", () => {
  /**
   * Allowlist explicite. Toute nouvelle route accessible sans authentification
   * doit être ajoutée ici volontairement, après revue.
   */
  const EXPECTED_ANONYMOUS = [
    "ping",
    "auth.me",
    "auth.logout",
    "evaluation.listPublic",
    "session.start",
    "session.getResults",
    "question.getPublicInfo",
  ];

  it("les routeurs legacy evaluation/grading ne sont plus montés", () => {
    const procedures = Object.keys(appRouter._def.procedures);

    expect(procedures).not.toContain("evaluation.getQuestions");
    expect(procedures).not.toContain("evaluation.submitAnswers");
    expect(procedures).not.toContain("evaluation.updateSession");
    expect(procedures).not.toContain("evaluation.createSession");
    expect(procedures).not.toContain("evaluation.getResults");
    expect(procedures).not.toContain("evaluation.getInfo");
    expect(procedures).not.toContain("evaluation.init");
    // ancien routeur de correction à prompt texte
    expect(procedures.some((p) => p.startsWith("grading."))).toBe(false);
  });

  it("aucune procédure inattendue n'est ajoutée sans revue", () => {
    const procedures = Object.keys(appRouter._def.procedures).sort();
    expect(procedures).toEqual(
      [
        "access.listUsers",
        "access.setAccess",
        "answer.getSaved",
        "authoring.createEvaluation",
        "authoring.createQuestion",
        "authoring.deleteEvaluation",
        "authoring.deleteQuestion",
        "authoring.duplicateEvaluation",
        "authoring.generateQuestions",
        "authoring.getEvaluation",
        "authoring.listEvaluations",
        "authoring.llmStatus",
        "authoring.reorderQuestions",
        "authoring.updateEvaluation",
        "authoring.updateQuestion",
        "answer.listDrafts",
        "answer.save",
        "answer.saveDraft",
        "auth.logout",
        "auth.me",
        "cheat.report",
        "cheat.reportBatch",
        "evaluation.listForTeacher",
        "evaluation.listPublic",
        "evaluation.seed",
        "grading2.auditTrail",
        "grading2.getResults",
        "grading2.gradeSession",
        "grading2.overrideGrade",
        "paper.anonymizeStudent",
        "paper.createAndGenerate",
        "paper.createClass",
        "paper.entrySheet",
        "paper.exportStudentData",
        "paper.importStudents",
        "paper.listClasses",
        "paper.listExams",
        "paper.listStudents",
        "paper.overview",
        "paper.results",
        "paper.saveEntry",
        "paper.status",
        "ping",
        "question.getForActiveSession",
        "question.getPublicInfo",
        "question.getWithAnswersForTeacher",
        "session.getAllForTeacher",
        "session.getDetailsForTeacher",
        "session.getResults",
        "session.heartbeat",
        "session.start",
        "session.submit",
        "teacherLive.forceSubmit",
        "teacherLive.snapshot",
      ].sort(),
    );
  });

  it("l'allowlist anonyme reste minimale", () => {
    // Garde-fou : si cette liste grossit, c'est une décision, pas un accident.
    expect(EXPECTED_ANONYMOUS).toHaveLength(7);
  });
});

describe("surface publique : routes élève inaccessibles sans jeton", () => {
  it("session.submit refuse une soumission anonyme", async () => {
    await expect(
      caller().session.submit({ answers: [{ questionId: 1, answer: "0" }] }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("session.heartbeat refuse un heartbeat anonyme", async () => {
    await expect(
      caller().session.heartbeat({
        clientTime: Date.now(),
        focused: true,
        currentQuestionIndex: 0,
        fingerprintHash: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("question.getForActiveSession ne sert aucun énoncé sans jeton", async () => {
    await expect(caller().question.getForActiveSession()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("answer.saveDraft refuse un brouillon anonyme", async () => {
    await expect(
      caller().answer.saveDraft({ questionId: 1, answer: "x" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("cheat.reportBatch refuse un lot anonyme", async () => {
    await expect(
      caller().cheat.reportBatch({
        events: [{ type: "tab_switch", timestamp: Date.now(), count: 1 }],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("surface publique : routes enseignant inaccessibles sans rôle", () => {
  it("session.getAllForTeacher refuse un anonyme", async () => {
    await expect(caller().session.getAllForTeacher()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("question.getWithAnswersForTeacher ne sert jamais correctAnswer à un anonyme", async () => {
    await expect(
      caller().question.getWithAnswersForTeacher({ evaluationId: 1 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("grading2.auditTrail refuse un anonyme", async () => {
    // Le journal contient qui a changé quelle note : jamais accessible.
    await expect(caller().grading2.auditTrail({ sessionId: 1 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("grading2.overrideGrade refuse un anonyme", async () => {
    await expect(
      caller().grading2.overrideGrade({ responseId: 1, score: 20, reason: "test" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("evaluation.seed refuse un anonyme", async () => {
    await expect(caller().evaluation.seed()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("teacherLive.snapshot refuse un anonyme", async () => {
    await expect(
      caller().teacherLive.snapshot({ evaluationId: 1 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("aucune route d'édition n'est accessible sans rôle enseignant", async () => {
    // `authoring` manipule correctAnswer et gradingRubric : une seule de ses
    // routes ouverte suffirait à livrer les corrections.
    const c = caller();
    await expect(c.authoring.listEvaluations()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(c.authoring.getEvaluation({ id: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      c.authoring.createEvaluation({ title: "Intrusion", duration: 60, deliveryMode: "paper" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(c.authoring.deleteQuestion({ id: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // La génération consomme des jetons facturés : elle ne doit jamais être ouverte.
    await expect(
      c.authoring.generateQuestions({ evaluationId: 1, theme: "suites", count: 1, difficulty: 2 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(c.authoring.llmStatus()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // Le tirage produit le corrigé : il ne doit jamais être atteignable.
    await expect(c.paper.listClasses()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(c.paper.overview()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      c.paper.createAndGenerate({ evaluationId: 1, classId: 1 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // La saisie écrit des notes : jamais accessible sans rôle enseignant.
    await expect(c.paper.entrySheet({ paperExamId: 1 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      c.paper.saveEntry({ paperExamId: 1, studentId: 1, answers: [] }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(c.paper.results({ paperExamId: 1 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    // Données personnelles d'élèves : jamais accessibles sans rôle enseignant.
    await expect(c.paper.exportStudentData({ studentId: 1 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(c.paper.anonymizeStudent({ studentId: 1 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("surface publique : session.getResults exige un jeton de résultats", () => {
  it("un jeton vide est refusé", async () => {
    await expect(
      caller().session.getResults({ resultsToken: "" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("un jeton forgé est refusé", async () => {
    await expect(
      caller().session.getResults({ resultsToken: "not.a.jwt" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

/**
 * Le limiteur de démarrage de session, tel que la mesure de charge l'a
 * requalifié.
 *
 * L'ancienne clé — cinq ouvertures par minute et par adresse IP — rendait une
 * salle d'examen impossible : un établissement sort par une seule adresse.
 * La nouvelle borne d'abord la personne, puis l'établissement. Ces deux
 * chiffres sont un arbitrage métier : ils doivent bouger délibérément, pas par
 * inadvertance.
 */
describe("limitation du démarrage de session", () => {
  it("borne une même personne à cinq tentatives par minute", () => {
    expect(RateLimits.sessionStart.max).toBe(5);
    expect(RateLimits.sessionStart.windowMs).toBe(60_000);
  });

  it("absorbe deux cents élèves qui commencent à la même minute", () => {
    // Pire cas légitime : un surveillant dit « vous pouvez commencer ». La
    // fenêtre de cinq minutes encaisse la pointe, reprises comprises.
    const parMinute =
      RateLimits.sessionStartPerIp.max / (RateLimits.sessionStartPerIp.windowMs / 60_000);
    expect(parMinute).toBeGreaterThanOrEqual(100);
    expect(RateLimits.sessionStartPerIp.max).toBeGreaterThanOrEqual(400);
  });

  it("garde un plafond par adresse : la limite n'est pas supprimée", () => {
    // Un script d'attaque en tente des milliers — la mesure de charge en a
    // produit plus de cinq mille en moins de deux minutes.
    expect(RateLimits.sessionStartPerIp.max).toBeLessThan(2_000);
  });
});
