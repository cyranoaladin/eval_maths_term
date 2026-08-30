/**
 * Le moteur de correction d'une session, éprouvé sur une base simulée.
 *
 * `gradeSessionResponses` est la source unique de correction : c'est lui qui
 * décide de la note de chaque copie. Ses règles les plus délicates — conserver
 * une note posée à la main, ne noter que les questions réellement imprimées,
 * ne pas perdre une copie entière parce qu'une réponse fait échouer un
 * comparateur — n'étaient vérifiées par rien.
 *
 * La base est remplacée par un double : ce qui est testé ici, c'est la
 * décision du moteur, pas MySQL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { responses, sessions } from "@db/schema";
import { shuffleDeterministic } from "../shuffle";
import { optionShuffleSeed } from "../grade-session";
import type { GradingRubric } from "@contracts/grading-rubric";

interface LigneSession {
  id: number; evaluationId: number; shuffleSeed: string; mode: string;
}
interface LigneQuestion {
  id: number; evaluationId: number; type: string; question: string;
  options: unknown; points: number; gradingRubric: unknown; order: number;
}
interface LigneReponse {
  id: number; sessionId: number; questionId: number; answer: string;
  justification: string | null; score: string | null; gradingMode: string | null;
}

interface MiseAJour { table: unknown; valeurs: Record<string, unknown> }

const etat: {
  sessions: LigneSession[];
  questions: LigneQuestion[];
  responses: LigneReponse[];
  misesAJour: MiseAJour[];
} = { sessions: [], questions: [], responses: [], misesAJour: [] };

/**
 * Double de la base : juste assez pour répondre aux quatre formes d'appel du
 * moteur. Une promesse est renvoyée par `where`, et `limit` la prolonge.
 */
function fauxDb() {
  const lignesDe = (table: unknown) =>
    table === sessions ? etat.sessions : table === responses ? etat.responses : etat.questions;

  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const p = Promise.resolve(lignesDe(table));
          return Object.assign(p, { limit: () => p });
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (valeurs: Record<string, unknown>) => ({
        where: () => {
          etat.misesAJour.push({ table, valeurs });
          return Promise.resolve();
        },
      }),
    }),
    // Le moteur applique désormais ses écritures en une transaction : le double
    // doit l'offrir, sans quoi il ne représenterait plus la base.
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(fauxDb()),
  };
}

vi.mock("../../queries/connection", () => ({ getDb: () => fauxDb() }));

const { gradeSessionResponses } = await import("../grade-session");

/** Reproduit l'ordre des propositions tel que l'élève les voit. */
function optionsVuesParEleve(options: string[], graine: string, questionId: number): string[] {
  return shuffleDeterministic(options, optionShuffleSeed(graine, questionId));
}

function question(id: number, points: number, rubric: GradingRubric | null, type = "short_answer"): LigneQuestion {
  return {
    id, evaluationId: 1, type, question: `Question ${id}`,
    options: null, points, gradingRubric: rubric, order: id,
  };
}

const barèmeNumérique = (valeur: number, poids: number): GradingRubric => ({
  mode: { kind: "numeric", value: valeur, tolerance: 1e-9, relative: false },
  llmReviewRequired: false,
  weight: poids,
});

function reponse(id: number, questionId: number, answer: string, extra: Partial<LigneReponse> = {}): LigneReponse {
  return {
    id, sessionId: 1, questionId, answer,
    justification: null, score: null, gradingMode: null, ...extra,
  };
}

beforeEach(() => {
  etat.sessions = [{ id: 1, evaluationId: 1, shuffleSeed: "graine-test", mode: "online" }];
  etat.questions = [];
  etat.responses = [];
  etat.misesAJour = [];
});

/**
 * Ordres d'écriture émis sur les réponses.
 *
 * Le moteur écrit toute la copie en un seul ordre : ce double compte donc des
 * ordres, pas des lignes. Ce que chaque ligne reçoit se vérifie contre une
 * vraie base, dans `api/__tests__/integration/` — c'est là que la question a
 * un sens.
 */
function ordresSurLesReponses(): Record<string, unknown>[] {
  return etat.misesAJour.filter((m) => m.table === responses).map((m) => m.valeurs);
}
function ecritureSession(): Record<string, unknown> | undefined {
  return etat.misesAJour.filter((m) => m.table === sessions).at(-1)?.valeurs;
}

describe("gradeSessionResponses", () => {
  it("refuse de corriger une session inexistante", async () => {
    etat.sessions = [];
    await expect(gradeSessionResponses(1)).rejects.toThrow(/introuvable/i);
  });

  it("corrige et totalise les réponses automatiques", async () => {
    etat.questions = [question(10, 2, barèmeNumérique(2, 2)), question(11, 3, barèmeNumérique(5, 3))];
    etat.responses = [reponse(100, 10, "2"), reponse(101, 11, "5")];

    const r = await gradeSessionResponses(1);
    expect(r.totalScore).toBe(5);
    expect(r.maxScore).toBe(5);
    expect(r.normalizedScore).toBe(20);
    expect(r.gradedCount).toBe(2);
  });

  it("conserve une note posée à la main et ne la recalcule pas", async () => {
    // Règle intangible : une intervention de l'enseignant ne doit jamais être
    // écrasée par une relance de correction automatique.
    etat.questions = [question(10, 2, barèmeNumérique(2, 2)), question(11, 2, barèmeNumérique(2, 2))];
    etat.responses = [
      reponse(100, 10, "réponse hors barème", { score: "1.50", gradingMode: "manual_override" }),
      reponse(101, 11, "2"),
    ];

    const r = await gradeSessionResponses(1);
    expect(r.totalScore).toBe(3.5);
    expect(r.gradedCount).toBe(2);
    // La réponse notée à la main n'a fait l'objet d'aucune réécriture.
    // Un seul ordre, et il ne concerne que la réponse corrigée automatiquement.
    expect(ordresSurLesReponses()).toHaveLength(1);
  });

  it("conserve aussi une note de saisie papier", async () => {
    etat.questions = [question(10, 2, barèmeNumérique(2, 2))];
    etat.responses = [reponse(100, 10, "", { score: "0.75", gradingMode: "manual_paper" })];

    const r = await gradeSessionResponses(1);
    expect(r.totalScore).toBe(0.75);
    // Aucune écriture : la note de la saisie papier est conservée telle quelle.
    expect(ordresSurLesReponses()).toHaveLength(0);
  });

  it("ne note que les questions réellement soumises à l'élève", async () => {
    // Sur papier, la composition d'un tirage est figée : une question absente
    // du sujet ne doit ni rapporter ni coûter de points.
    etat.questions = [
      question(10, 2, barèmeNumérique(2, 2)),
      question(11, 2, barèmeNumérique(2, 2)),
      question(12, 6, barèmeNumérique(2, 6)),
    ];
    etat.responses = [reponse(100, 10, "2"), reponse(101, 11, "2"), reponse(102, 12, "2")];

    const r = await gradeSessionResponses(1, { questionIds: [10, 11] });
    expect(r.maxScore).toBe(4);
    expect(r.totalScore).toBe(4);
    expect(r.normalizedScore).toBe(20);
    expect(r.gradedCount).toBe(2);
  });

  it("compte une question du périmètre restée sans réponse", async () => {
    etat.questions = [question(10, 2, barèmeNumérique(2, 2)), question(11, 2, barèmeNumérique(2, 2))];
    etat.responses = [reponse(100, 10, "2")];

    const r = await gradeSessionResponses(1);
    expect(r.maxScore).toBe(4);
    expect(r.totalScore).toBe(2);
    expect(r.normalizedScore).toBe(10);
  });

  it("ignore une réponse dont la question a disparu", async () => {
    etat.questions = [question(10, 2, barèmeNumérique(2, 2))];
    etat.responses = [reponse(100, 10, "2"), reponse(101, 999, "2")];

    const r = await gradeSessionResponses(1);
    expect(r.gradedCount).toBe(1);
  });

  it("laisse à l'enseignant une question sans barème", async () => {
    etat.questions = [question(10, 2, null)];
    etat.responses = [reponse(100, 10, "2")];

    const r = await gradeSessionResponses(1);
    expect(r.needsManualReview).toBe(1);
    expect(r.gradedCount).toBe(0);
  });

  it("laisse à l'enseignant une question au barème illisible", async () => {
    etat.questions = [question(10, 2, { mode: { kind: "inconnu" } } as unknown as GradingRubric)];
    etat.responses = [reponse(100, 10, "2")];

    const r = await gradeSessionResponses(1);
    expect(r.needsManualReview).toBe(1);
    expect(r.gradedCount).toBe(0);
  });

  it("arrondit la note sur 20 au quart de point", async () => {
    etat.questions = [question(10, 3, barèmeNumérique(2, 3))];
    etat.responses = [reponse(100, 10, "2")];
    await gradeSessionResponses(1);
    expect(ecritureSession()?.normalizedScore).toBe("20.00");

    etat.misesAJour = [];
    etat.questions = [question(10, 3, barèmeNumérique(2, 3)), question(11, 4, barèmeNumérique(9, 4))];
    etat.responses = [reponse(100, 10, "2"), reponse(101, 11, "0")];
    const r = await gradeSessionResponses(1);
    // 3 points sur 7 → 8,571… sur 20 → 8,5 au quart de point près.
    expect(r.normalizedScore).toBe(8.5);
  });

  it("écrit une note nulle plutôt que de diviser par zéro", async () => {
    etat.questions = [];
    etat.responses = [];
    const r = await gradeSessionResponses(1);
    expect(r.normalizedScore).toBe(0);
    expect(r.maxScore).toBe(0);
  });

  it("inscrit les totaux sur la session", async () => {
    etat.questions = [question(10, 2, barèmeNumérique(2, 2))];
    etat.responses = [reponse(100, 10, "2")];
    await gradeSessionResponses(1);
    const s = ecritureSession();
    expect(s?.totalScore).toBe("2.00");
    expect(s?.maxScore).toBe(2);
  });

  it("laisse une réponse à l'enseignant quand le LLM est sauté", async () => {
    etat.questions = [question(10, 2, { ...barèmeNumérique(2, 2), llmReviewRequired: true })];
    etat.responses = [reponse(100, 10, "à peu près deux")];

    const r = await gradeSessionResponses(1, { skipLLM: true });
    expect(r.needsManualReview).toBe(1);
  });

  it("n'écrit qu'un seul ordre pour toute la copie", async () => {
    // C'est ce qui rend une fin d'épreuve tenable : vingt et une réponses,
    // un seul aller-retour.
    etat.questions = Array.from({ length: 21 }, (_, i) =>
      question(10 + i, 1, barèmeNumérique(2, 1)),
    );
    etat.responses = etat.questions.map((q, i) => reponse(100 + i, q.id, "2"));
    await gradeSessionResponses(1);
    expect(ordresSurLesReponses()).toHaveLength(1);
  });

  it("reconvertit l'index d'un QCM avant de le corriger", async () => {
    // L'élève voit les propositions mélangées et soumet une position dans
    // l'ordre qu'il a sous les yeux ; le barème, lui, désigne l'ordre
    // d'origine. Sans reconversion, la note d'un QCM serait arbitraire.
    const options = ["$0$", "$1$", "$2$", "$4$"];
    const qcm: LigneQuestion = {
      id: 20, evaluationId: 1, type: "qcm", question: "Combien ?",
      options, points: 2, order: 1,
      gradingRubric: {
        mode: { kind: "qcm", correctIndex: 2 },
        llmReviewRequired: false,
        weight: 2,
      } satisfies GradingRubric,
    };
    etat.questions = [qcm];

    const vues = optionsVuesParEleve(options, "graine-test", 20);
    const positionVue = vues.indexOf(options[2]);
    etat.responses = [reponse(200, 20, String(positionVue))];

    const r = await gradeSessionResponses(1);
    expect(r.totalScore, `position vue ${positionVue}`).toBe(2);
    expect(r.gradedCount).toBe(1);
  });

  it("refuse le même index quand il ne désigne pas la bonne proposition", async () => {
    const options = ["$0$", "$1$", "$2$", "$4$"];
    etat.questions = [{
      id: 20, evaluationId: 1, type: "qcm", question: "Combien ?",
      options, points: 2, order: 1,
      gradingRubric: {
        mode: { kind: "qcm", correctIndex: 2 },
        llmReviewRequired: false,
        weight: 2,
      } satisfies GradingRubric,
    }];
    const vues = optionsVuesParEleve(options, "graine-test", 20);
    const mauvaise = (vues.indexOf(options[2]) + 1) % options.length;
    etat.responses = [reponse(200, 20, String(mauvaise))];

    const r = await gradeSessionResponses(1);
    expect(r.totalScore).toBe(0);
  });

  it("ne s'effondre pas sur des propositions illisibles", async () => {
    // Les propositions sont stockées en JSON : une valeur corrompue ne doit
    // pas faire échouer la correction de toute la copie.
    etat.questions = [{
      id: 20, evaluationId: 1, type: "qcm", question: "Combien ?",
      options: "{ ceci n'est pas du JSON", points: 2, order: 1,
      gradingRubric: {
        mode: { kind: "qcm", correctIndex: 0 },
        llmReviewRequired: false,
        weight: 2,
      } satisfies GradingRubric,
    }];
    etat.responses = [reponse(200, 20, "0")];
    const r = await gradeSessionResponses(1);
    expect(r.gradedCount).toBe(1);
  });

  it("ne s'effondre pas sur du JSON valide qui n'est pas une liste", async () => {
    // Le champ est lisible mais ne contient pas ce qu'on attend : mieux vaut
    // une correction sans propositions qu'une exception au milieu d'une copie.
    etat.questions = [{
      id: 20, evaluationId: 1, type: "qcm", question: "Combien ?",
      options: '{"a": 1}', points: 2, order: 1,
      gradingRubric: {
        mode: { kind: "qcm", correctIndex: 0 },
        llmReviewRequired: false,
        weight: 2,
      } satisfies GradingRubric,
    }];
    etat.responses = [reponse(200, 20, "0")];
    const r = await gradeSessionResponses(1);
    expect(r.gradedCount).toBe(1);
  });

  it("ne s'effondre pas sur des propositions qui ne sont pas une liste", async () => {
    etat.questions = [{
      id: 20, evaluationId: 1, type: "qcm", question: "Combien ?",
      options: { a: 1 }, points: 2, order: 1,
      gradingRubric: {
        mode: { kind: "qcm", correctIndex: 0 },
        llmReviewRequired: false,
        weight: 2,
      } satisfies GradingRubric,
    }];
    etat.responses = [reponse(200, 20, "0")];
    const r = await gradeSessionResponses(1);
    expect(r.gradedCount).toBe(1);
  });

  it("corrige un QCM sur papier sans reconvertir", async () => {
    // Sur papier, l'ordre imprimé est l'ordre d'origine : la position saisie
    // par l'enseignant désigne directement la proposition.
    etat.sessions = [{ id: 1, evaluationId: 1, shuffleSeed: "graine-test", mode: "paper" }];
    const options = ["$0$", "$1$", "$2$", "$4$"];
    etat.questions = [{
      id: 20, evaluationId: 1, type: "qcm", question: "Combien ?",
      options, points: 2, order: 1,
      gradingRubric: {
        mode: { kind: "qcm", correctIndex: 2 },
        llmReviewRequired: false,
        weight: 2,
      } satisfies GradingRubric,
    }];
    etat.responses = [reponse(200, 20, "2")];

    const r = await gradeSessionResponses(1);
    expect(r.totalScore).toBe(2);
  });
});
