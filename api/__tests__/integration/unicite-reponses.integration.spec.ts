/**
 * La contrainte d'unicité sur (session, question).
 *
 * Une copie ne peut pas porter deux réponses à la même question. Rien ne
 * l'empêchait jusqu'ici, et la base de développement en portait effectivement
 * deux — strictement identiques, trace de l'ancien chemin d'écriture qui
 * relisait puis insérait. La règle est maintenant tenue par la base
 * elle-même, donc vraie y compris sous concurrence.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  creerEnseignant, creerEvaluation, db, nettoyer, ouvrirSession, unique,
} from "./harnais";
import { responses, sessions } from "@db/schema";
import type { User } from "@db/schema";

let prof: User;
let evaluationId: number;
let questionIds: number[];
let autreEvaluation: { evaluationId: number; questionIds: number[] };

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant unicité");
  const ev = await creerEvaluation(prof, "Unicité");
  evaluationId = ev.evaluationId;
  questionIds = ev.questionIds;
  autreEvaluation = await creerEvaluation(prof, "Unicité bis");
});

afterAll(async () => {
  await nettoyer([evaluationId, autreEvaluation.evaluationId], [prof.id]);
});

describe("la contrainte existe réellement dans MySQL", () => {
  it("est déclarée unique sur (sessionId, questionId)", async () => {
    const [lignes] = await db.execute(sql`
      SELECT COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'responses'
        AND INDEX_NAME = 'uq_responses_session_question'
      ORDER BY SEQ_IN_INDEX
    `);
    const colonnes = lignes as unknown as Array<{ COLUMN_NAME: string; NON_UNIQUE: number }>;
    expect(colonnes.map((c) => c.COLUMN_NAME)).toEqual(["sessionId", "questionId"]);
    expect(colonnes.every((c) => Number(c.NON_UNIQUE) === 0)).toBe(true);
  });
});

describe("ce que la contrainte refuse et ce qu'elle laisse passer", () => {
  it("refuse deux réponses à la même question dans la même copie", async () => {
    const { sessionId } = await ouvrirSession(evaluationId, unique("Unicité"));
    await db.insert(responses).values({
      sessionId, questionId: questionIds[0], answer: "première",
    });

    let refus: unknown;
    try {
      await db.insert(responses).values({
        sessionId, questionId: questionIds[0], answer: "seconde",
      });
    } catch (e) {
      refus = e;
    }
    expect(refus).toBeDefined();
    expect(
      [String(refus), String((refus as { cause?: unknown })?.cause ?? "")].join(" "),
    ).toMatch(/duplicate|ER_DUP_ENTRY/i);

    // La première réponse est intacte : rien n'a été écrasé.
    const lignes = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
    expect(lignes).toHaveLength(1);
    expect(lignes[0].answer).toBe("première");

    await db.delete(responses).where(eq(responses.sessionId, sessionId));
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  });

  it("accepte la même question dans deux copies différentes", async () => {
    // Deux élèves répondent à la même question : c'est le cas ordinaire.
    const a = await ouvrirSession(evaluationId, unique("Élève A"));
    const b = await ouvrirSession(evaluationId, unique("Élève B"));
    await db.insert(responses).values([
      { sessionId: a.sessionId, questionId: questionIds[0], answer: "réponse de A" },
      { sessionId: b.sessionId, questionId: questionIds[0], answer: "réponse de B" },
    ]);
    expect(
      await db.select().from(responses).where(eq(responses.questionId, questionIds[0])),
    ).toHaveLength(2);

    for (const s of [a, b]) {
      await db.delete(responses).where(eq(responses.sessionId, s.sessionId));
      await db.delete(sessions).where(eq(sessions.id, s.sessionId));
    }
  });

  it("accepte deux questions différentes dans la même copie", async () => {
    const { sessionId } = await ouvrirSession(evaluationId, unique("Unicité"));
    await db.insert(responses).values([
      { sessionId, questionId: questionIds[0], answer: "une" },
      { sessionId, questionId: questionIds[1], answer: "deux" },
      { sessionId, questionId: questionIds[2], answer: "trois" },
    ]);
    expect(await db.select().from(responses).where(eq(responses.sessionId, sessionId))).toHaveLength(3);

    await db.delete(responses).where(eq(responses.sessionId, sessionId));
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  });

  it("accepte la même question de deux évaluations différentes", async () => {
    // Les identifiants de questions diffèrent : rien ne les rapproche.
    const { sessionId } = await ouvrirSession(evaluationId, unique("Unicité"));
    await db.insert(responses).values([
      { sessionId, questionId: questionIds[0], answer: "ici" },
      { sessionId, questionId: autreEvaluation.questionIds[0], answer: "ailleurs" },
    ]);
    expect(await db.select().from(responses).where(eq(responses.sessionId, sessionId))).toHaveLength(2);

    await db.delete(responses).where(eq(responses.sessionId, sessionId));
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  });
});
