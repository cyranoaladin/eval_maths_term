/**
 * Le bail de remise.
 *
 * Rendre une copie commence par la prendre : une seule requête peut poser la
 * date de fin, ce qui empêche deux remises simultanées d'écrire les mêmes
 * réponses. Mais une prise sans relâchement serait pire que le mal — si la
 * correction échoue, la copie resterait prise, l'élève ne pourrait plus rendre,
 * et rien ne le débloquerait avant le balayage d'inactivité.
 *
 * Le moteur de correction est remplacé le temps de ce cas : ce qu'on éprouve,
 * c'est ce que fait la remise quand quelque chose casse en cours de route.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sessions } from "@db/schema";

const gradeSessionResponses = vi.fn();
vi.mock("../../grading/grade-session", () => ({ gradeSessionResponses }));

const { appelEleve, creerEnseignant, creerEvaluation, db, nettoyer, ouvrirSession, unique } =
  await import("./harnais");
type Utilisateur = Awaited<ReturnType<typeof creerEnseignant>>;

let prof: Utilisateur;
let evaluationId = 0;
let questionIds: number[] = [];

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant bail");
  const ev = await creerEvaluation(prof, "Bail");
  evaluationId = ev.evaluationId;
  questionIds = ev.questionIds;
});

afterAll(async () => {
  await nettoyer([evaluationId], [prof.id]);
});

describe("échec en cours de remise", () => {
  it("relâche la copie pour que l'élève puisse rendre à nouveau", async () => {
    const { sessionId, jeton } = await ouvrirSession(evaluationId, unique("Élève malchanceux"));
    gradeSessionResponses.mockRejectedValueOnce(new Error("le moteur de correction a lâché"));

    await expect(
      appelEleve(jeton).session.submit({
        answers: [{ questionId: questionIds[0], answer: "1" }],
      }),
    ).rejects.toThrow(/le moteur de correction a lâché/);

    const [apres] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    // La date de fin est retirée : sans cela, la copie resterait prise et
    // l'élève verrait « cette session est déjà terminée » sans avoir rien rendu.
    expect(apres.endedAt).toBeNull();
    expect(apres.status).toBe("in_progress");
  });

  it("laisse la remise suivante aboutir", async () => {
    const { sessionId, jeton } = await ouvrirSession(evaluationId, unique("Élève qui réessaie"));
    const api = appelEleve(jeton);
    gradeSessionResponses.mockRejectedValueOnce(new Error("coupure passagère"));

    await expect(
      api.session.submit({ answers: [{ questionId: questionIds[0], answer: "1" }] }),
    ).rejects.toThrow();

    gradeSessionResponses.mockResolvedValueOnce({
      totalScore: 2,
      maxScore: 6,
      normalizedScore: 6.67,
      needsManualReview: false,
    });

    const rendu = await api.session.submit({
      answers: [{ questionId: questionIds[0], answer: "1" }],
    });

    expect(rendu.success).toBe(true);
    const [apres] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(apres.endedAt).not.toBeNull();
    expect(apres.status).toBe("completed");
  });
});
