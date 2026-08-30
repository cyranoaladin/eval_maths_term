/**
 * Correction, intervention manuelle et surveillance, contre une vraie base.
 *
 * L'invariant qui compte : une note posée à la main par l'enseignant survit à
 * toute relance de la correction automatique, et chaque intervention laisse
 * une trace qu'on ne peut ni effacer ni falsifier depuis le client.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  appelAnonyme, appelEleve, appelEnseignant, creerEnseignant, creerEvaluation,
  db, nettoyer, ouvrirSession, unique,
} from "./harnais";
import { questions, responses, sessions } from "@db/schema";
import { withRequestId } from "../../lib/request-id";
import type { User } from "@db/schema";

let prof: User;
let intrus: User;
let evaluationId: number;

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant correcteur");
  intrus = await creerEnseignant("Enseignant tiers");
  const ev = await creerEvaluation(prof, "Correction");
  evaluationId = ev.evaluationId;
});

afterAll(async () => {
  await nettoyer([evaluationId], [prof.id, intrus.id]);
});

/** Une copie remise, prête à être corrigée. */
async function copieRemise(): Promise<{ sessionId: number }> {
  const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
  const eleve = appelEleve(jeton);
  const qs = await eleve.question.getForActiveSession();
  const qcm = qs.find((q) => q.type === "qcm")!;
  await eleve.session.submit({
    answers: [
      { questionId: qcm.id, answer: String(qcm.options!.indexOf("$4$")) },
      { questionId: qs.find((q) => q.type === "true_false")!.id, answer: "true" },
      { questionId: qs.find((q) => q.type === "short_answer")!.id, answer: "x" },
    ],
    timeSpent: 200,
  });
  return { sessionId };
}

describe("lecture des copies par l'enseignant", () => {
  it("montre le détail question par question", async () => {
    const { sessionId } = await copieRemise();
    const detail = await appelEnseignant(prof).session.getDetailsForTeacher({ sessionId });
    expect(detail.responses).toHaveLength(3);
    expect(detail.responses.every((r) => r.gradingMode !== null)).toBe(true);
    // L'enseignant, lui, a le droit de voir la bonne réponse.
    expect(JSON.stringify(detail.responses)).toContain("question");
  });

  it("liste les copies de ses évaluations", async () => {
    const { sessionId } = await copieRemise();
    const liste = await appelEnseignant(prof).session.getAllForTeacher();
    expect(liste.some((s) => s.id === sessionId)).toBe(true);
    // Et pas celles des autres.
    const autre = await appelEnseignant(intrus).session.getAllForTeacher();
    expect(autre.some((s) => s.id === sessionId)).toBe(false);
  });

  it("rend les résultats détaillés", async () => {
    const { sessionId } = await copieRemise();
    const res = await appelEnseignant(prof).grading2.getResults({ sessionId });
    expect(res.details).toHaveLength(3);
    expect(res.details.every((d) => d.gradingMode !== null)).toBe(true);
  });
});

describe("intervention manuelle", () => {
  it("remplace une note, la trace, et la protège d'une recorrection", async () => {
    const { sessionId } = await copieRemise();
    const api = appelEnseignant(prof);

    const detail = await api.session.getDetailsForTeacher({ sessionId });
    const cible = detail.responses.find((r) => r.question?.type === "short_answer")!;
    expect(cible.score).toBe(0);

    await api.grading2.overrideGrade({
      responseId: cible.id,
      score: 1.5,
      reason: "Raisonnement juste, écriture maladroite",
    });

    const apres = await api.session.getDetailsForTeacher({ sessionId });
    const corrigee = apres.responses.find((r) => r.id === cible.id)!;
    expect(corrigee.score).toBe(1.5);
    expect(corrigee.gradingMode).toBe("manual_override");

    // La relance automatique ne doit pas y toucher.
    const relance = await api.grading2.gradeSession({ sessionId, reason: "Relance de contrôle" });
    expect(relance.success).toBe(true);

    const finale = await api.session.getDetailsForTeacher({ sessionId });
    const survivante = finale.responses.find((r) => r.id === cible.id)!;
    expect(survivante.score, "la note manuelle a été écrasée").toBe(1.5);
    expect(survivante.gradingMode).toBe("manual_override");
  });

  it("plafonne la note au barème de la question", async () => {
    const { sessionId } = await copieRemise();
    const api = appelEnseignant(prof);
    const detail = await api.session.getDetailsForTeacher({ sessionId });
    const cible = detail.responses.find((r) => r.question?.type === "true_false")!;

    await expect(
      api.grading2.overrideGrade({ responseId: cible.id, score: 99, reason: "Trop généreux" }),
    ).rejects.toThrow(/point/i);
  });

  it("exige un motif", async () => {
    const { sessionId } = await copieRemise();
    const api = appelEnseignant(prof);
    const detail = await api.session.getDetailsForTeacher({ sessionId });
    const cible = detail.responses[0];

    await expect(
      api.grading2.overrideGrade({ responseId: cible.id, score: 1, reason: "" }),
    ).rejects.toThrow();
    await expect(
      api.grading2.overrideGrade({ responseId: cible.id, score: 1, reason: "ok" }),
    ).rejects.toThrow();
  });

  it("ajoute une entrée par intervention, sans en corriger aucune", async () => {
    const { sessionId } = await copieRemise();
    const api = appelEnseignant(prof);
    const detail = await api.session.getDetailsForTeacher({ sessionId });
    const cible = detail.responses.find((r) => r.question?.type === "short_answer")!;

    // L'identifiant de requête vient du contexte HTTP : on rejoue ce contexte
    // pour vérifier qu'il est bien rattaché à la trace.
    await withRequestId("req-integration-1", () =>
      api.grading2.overrideGrade({ responseId: cible.id, score: 1, reason: "Première lecture" }),
    );
    await withRequestId("req-integration-2", () =>
      api.grading2.overrideGrade({ responseId: cible.id, score: 2, reason: "Après relecture" }),
    );

    const journal = await api.grading2.auditTrail({ sessionId });
    const interventions = journal.filter((l) => l.action === "manual_override");
    expect(interventions).toHaveLength(2);

    // Le plus récent en tête, et chaque entrée porte son avant et son après.
    expect(interventions[0].nouvelleNote).toBe(2);
    expect(interventions[0].ancienneNote).toBe(1);
    expect(interventions[0].motif).toBe("Après relecture");
    expect(interventions[1].nouvelleNote).toBe(1);
    expect(interventions[1].motif).toBe("Première lecture");

    // Auteur et identifiant de requête sont consignés.
    expect(interventions[0].auteur).toBe(prof.email);
    expect(interventions[0].requestId).toBe("req-integration-2");
    expect(interventions[1].requestId).toBe("req-integration-1");

    // La relance laisse sa propre trace sans effacer les précédentes.
    await api.grading2.gradeSession({ sessionId, reason: "Relance" });
    const apres = await api.grading2.auditTrail({ sessionId });
    expect(apres.filter((l) => l.action === "manual_override")).toHaveLength(2);
    expect(apres.some((l) => l.action === "regrade")).toBe(true);
  });

  it("refuse toute intervention d'un collègue ou d'un anonyme", async () => {
    const { sessionId } = await copieRemise();
    const detail = await appelEnseignant(prof).session.getDetailsForTeacher({ sessionId });
    const cible = detail.responses[0];
    const autre = appelEnseignant(intrus);

    await expect(
      autre.grading2.overrideGrade({ responseId: cible.id, score: 0, reason: "Tentative extérieure" }),
    ).rejects.toThrow();
    await expect(autre.grading2.auditTrail({ sessionId })).rejects.toThrow();
    await expect(autre.grading2.gradeSession({ sessionId })).rejects.toThrow();
    await expect(autre.grading2.getResults({ sessionId })).rejects.toThrow();

    await expect(
      appelAnonyme().grading2.overrideGrade({ responseId: cible.id, score: 0, reason: "Anonyme" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(appelAnonyme().grading2.auditTrail({ sessionId })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    // Et la note n'a pas bougé.
    const apres = await appelEnseignant(prof).session.getDetailsForTeacher({ sessionId });
    expect(apres.responses.find((r) => r.id === cible.id)!.score).toBe(cible.score);
  });

  it("refuse d'intervenir sur une réponse qui n'existe pas", async () => {
    await expect(
      appelEnseignant(prof).grading2.overrideGrade({
        responseId: 99_999_999, score: 1, reason: "Réponse fantôme",
      }),
    ).rejects.toThrow();
  });
});

describe("ce que la correction inscrit réellement sur chaque réponse", () => {
  it("porte le mode, la note et le retour de chaque question", async () => {
    // Le moteur écrit toute la copie en un seul ordre : c'est ici, contre une
    // vraie base, que se vérifie ce que chaque ligne reçoit.
    const { sessionId } = await copieRemise();
    const lignes = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
    expect(lignes).toHaveLength(3);

    for (const l of lignes) {
      expect(l.gradedAt, "chaque réponse porte sa date de correction").not.toBeNull();
      expect(l.gradingMode).toBeTruthy();
      expect(l.score).not.toBeNull();
      expect(l.gradingReason).toBeTruthy();
      // Correction déterministe : aucune confiance de correcteur assisté.
      expect(l.llmConfidence).toBeNull();
    }

    const modes = lignes.map((l) => l.gradingMode).sort();
    expect(modes).toEqual(["qcm", "symbolic:numeric", "true_false"].sort());

    // Chaque ligne reçoit sa propre note, pas celle de sa voisine.
    const parMode = new Map(lignes.map((l) => [l.gradingMode, Number(l.score)]));
    expect(parMode.get("qcm")).toBe(2);
    expect(parMode.get("true_false")).toBe(0);
  });

  it("laisse à l'enseignant une question dont le barème est illisible", async () => {
    const { sessionId } = await copieRemise();
    const detail = await appelEnseignant(prof).session.getDetailsForTeacher({ sessionId });
    const cible = detail.responses.find((r) => r.question?.type === "short_answer")!;

    // Un barème corrompu en base : la correction doit le dire, pas deviner.
    await db
      .update(questions)
      .set({ gradingRubric: { mode: { kind: "inconnu" } } as never })
      .where(eq(questions.id, cible.questionId));

    const r = await appelEnseignant(prof).grading2.gradeSession({ sessionId });
    expect(r.needsManualReview).toBeGreaterThanOrEqual(1);

    const [ligne] = await db.select().from(responses).where(eq(responses.id, cible.id));
    expect(ligne.gradingMode).toBe("invalid_rubric");
    expect(ligne.llmFeedback).toMatch(/manuellement/i);
    expect(Number(ligne.score)).toBe(0);

    // On remet le barème en place : les autres cas en dépendent.
    await db
      .update(questions)
      .set({
        gradingRubric: {
          mode: { kind: "symbolic", canonical: "2*x", variables: ["x"] },
          llmReviewRequired: false,
          weight: 3,
        },
      })
      .where(eq(questions.id, cible.questionId));
  });
});

describe("cas ordinaires du journal et de la correction", () => {
  it("rend un journal vide sur une copie jamais reprise", async () => {
    const { sessionId } = await copieRemise();
    expect(await appelEnseignant(prof).grading2.auditTrail({ sessionId })).toEqual([]);
  });

  it("accepte une intervention accompagnée d'un commentaire pour l'élève", async () => {
    // Le motif s'adresse à la traçabilité, le commentaire à l'élève : ce sont
    // deux textes distincts et tous deux doivent être conservés.
    const { sessionId } = await copieRemise();
    const api = appelEnseignant(prof);
    const detail = await api.session.getDetailsForTeacher({ sessionId });
    const cible = detail.responses.find((r) => r.question?.type === "short_answer")!;

    await api.grading2.overrideGrade({
      responseId: cible.id,
      score: 2,
      feedback: "Le raisonnement est juste, soignez l'écriture.",
      reason: "Barème appliqué à la lettre",
    });

    const apres = await api.session.getDetailsForTeacher({ sessionId });
    const corrigee = apres.responses.find((r) => r.id === cible.id)!;
    expect(corrigee.llmFeedback).toMatch(/soignez/);
    const journal = await api.grading2.auditTrail({ sessionId });
    expect(journal[0].motif).toBe("Barème appliqué à la lettre");
  });

  it("arrondit une note manuelle au quart de point", async () => {
    // C'est la finesse du barème : rien entre deux quarts n'a de sens.
    const { sessionId } = await copieRemise();
    const api = appelEnseignant(prof);
    const detail = await api.session.getDetailsForTeacher({ sessionId });
    const cible = detail.responses.find((r) => r.question?.type === "short_answer")!;

    await api.grading2.overrideGrade({
      responseId: cible.id, score: 1.13, reason: "Valeur à arrondir",
    });
    const apres = await api.session.getDetailsForTeacher({ sessionId });
    expect(apres.responses.find((r) => r.id === cible.id)!.score).toBe(1.25);
  });

  it("recorrige sans motif quand l'enseignant n'en donne pas", async () => {
    const { sessionId } = await copieRemise();
    const api = appelEnseignant(prof);
    const r = await api.grading2.gradeSession({ sessionId });
    expect(r.success).toBe(true);
    const journal = await api.grading2.auditTrail({ sessionId });
    expect(journal.some((l) => l.action === "regrade" && l.motif === null)).toBe(true);
  });
});

describe("surveillance en direct", () => {
  it("montre les compositions en cours et permet de forcer une remise", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Surveillé"));
    const eleve = appelEleve(jeton);
    await eleve.session.heartbeat({
      clientTime: Date.now(), focused: true, currentQuestionIndex: 0, fingerprintHash: "e",
    });

    const api = appelEnseignant(prof);
    const vue = await api.teacherLive.snapshot({ evaluationId });
    expect(vue.sessions.some((s) => s.sessionId === sessionId)).toBe(true);

    await api.teacherLive.forceSubmit({ sessionId });
    const [apres] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(apres.status).not.toBe("in_progress");

    // Deux fois de suite : la remise forcée d'une copie close est refusée.
    await expect(api.teacherLive.forceSubmit({ sessionId })).rejects.toThrow();
  });

  it("refuse de forcer la remise d'une copie d'un collègue", async () => {
    const { sessionId } = await ouvrirSession(evaluationId, unique("Protégé"));
    await expect(appelEnseignant(intrus).teacherLive.forceSubmit({ sessionId })).rejects.toThrow();
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  });
});

describe("signalements d'anti-triche", () => {
  it("enregistre un lot d'incidents et les compte côté enseignant", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Distrait"));
    await appelEleve(jeton).cheat.reportBatch({
      events: [
        { type: "tab_switch", timestamp: Date.now() },
        { type: "blur", timestamp: Date.now() },
      ],
    });

    const detail = await appelEnseignant(prof).session.getDetailsForTeacher({ sessionId });
    expect(detail.cheatEvents.length).toBeGreaterThanOrEqual(1);

    await db.delete(responses).where(eq(responses.sessionId, sessionId));
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  });

  it("refuse un signalement sans session", async () => {
    await expect(
      appelAnonyme().cheat.reportBatch({ events: [{ type: "blur", timestamp: Date.now() }] }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
