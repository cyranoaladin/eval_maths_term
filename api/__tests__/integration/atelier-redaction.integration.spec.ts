/**
 * L'atelier de rédaction, sur ses chemins de refus.
 *
 * Les cas passants sont éprouvés par `atelier-enseignant`. Ce qui manquait,
 * c'est ce que l'atelier refuse : activer une évaluation vide, supprimer une
 * évaluation déjà passée, réordonner avec une liste incomplète, générer sans
 * modèle configuré. Chacun de ces refus protège une donnée que personne ne
 * pourrait reconstituer après coup.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { asc, eq } from "drizzle-orm";
import { appelEnseignant, creerEnseignant, db, nettoyer, ouvrirSession, unique } from "./harnais";
import { questions } from "@db/schema";
import type { User } from "@db/schema";
import type { GradingRubric } from "@contracts/grading-rubric";
import { env } from "../../lib/env";

let prof: User;
const evaluationsCreees: number[] = [];
const FETCH_INITIAL = globalThis.fetch;
const CLE_INITIALE = env.llm.apiKey ?? "";

const barème = (correctIndex: number, poids = 2): GradingRubric => ({
  mode: { kind: "qcm", correctIndex },
  llmReviewRequired: false,
  weight: poids,
});

const questionQcm = (sur: Record<string, unknown> = {}) => ({
  type: "qcm" as const,
  question: "Combien font deux et deux ?",
  options: ["$3$", "$4$", "$5$", "$6$"],
  correctAnswer: "1",
  points: 2,
  gradingRubric: barème(1),
  ...sur,
});

async function evaluationVide(titre = "Rédaction"): Promise<number> {
  const { id } = await appelEnseignant(prof).authoring.createEvaluation({
    title: unique(titre),
    duration: 30,
  });
  evaluationsCreees.push(id);
  return id;
}

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant rédaction");
});

afterEach(() => {
  globalThis.fetch = FETCH_INITIAL;
  (env.llm as { apiKey: string }).apiKey = CLE_INITIALE;
});

afterAll(async () => {
  await nettoyer(evaluationsCreees, [prof.id]);
});

describe("liste des évaluations", () => {
  it("compte les questions, le barème total et les copies", async () => {
    const id = await evaluationVide("Comptage");
    const api = appelEnseignant(prof);
    await api.authoring.createQuestion({ evaluationId: id, question: questionQcm() });
    await api.authoring.createQuestion({
      evaluationId: id,
      question: questionQcm({ question: "Et trois et trois ?", points: 3, gradingRubric: barème(1, 3) }),
    });
    await ouvrirSession(id, "Élève du comptage");

    const ligne = (await api.authoring.listEvaluations()).find((e) => e.id === id)!;

    expect(ligne.questionCount).toBe(2);
    // MySQL rend les sommes en chaîne : un total affiché « 23 » au lieu de 5
    // serait passé inaperçu jusqu'à la copie de l'élève.
    expect(ligne.maxScore).toBe(5);
    expect(ligne.sessionCount).toBe(1);
  });

  it("montre une évaluation neuve à zéro plutôt qu'à vide", async () => {
    const id = await evaluationVide("Neuve");
    const ligne = (await appelEnseignant(prof).authoring.listEvaluations()).find((e) => e.id === id)!;
    expect(ligne).toMatchObject({ questionCount: 0, maxScore: 0, sessionCount: 0 });
  });
});

describe("activation", () => {
  it("refuse d'activer une évaluation sans question", async () => {
    const id = await evaluationVide("Vide");
    await expect(
      appelEnseignant(prof).authoring.updateEvaluation({ id, isActive: true }),
    ).rejects.toThrow(/sans question/);
  });

  it("accepte d'activer dès qu'une question existe", async () => {
    const id = await evaluationVide("Prête");
    const api = appelEnseignant(prof);
    await api.authoring.createQuestion({ evaluationId: id, question: questionQcm() });

    await expect(api.authoring.updateEvaluation({ id, isActive: true })).resolves.toEqual({
      success: true,
    });
    expect((await api.authoring.getEvaluation({ id })).evaluation.isActive).toBe(true);
  });

  it("laisse désactiver sans rien vérifier : c'est le sens qui protège", async () => {
    const id = await evaluationVide("À fermer");
    await expect(
      appelEnseignant(prof).authoring.updateEvaluation({ id, isActive: false }),
    ).resolves.toEqual({ success: true });
  });
});

describe("suppression", () => {
  it("refuse de supprimer une évaluation qui a déjà des copies", async () => {
    const id = await evaluationVide("Déjà passée");
    await ouvrirSession(id, "Élève déjà passé");

    await expect(appelEnseignant(prof).authoring.deleteEvaluation({ id })).rejects.toThrow(
      /copie\(s\).*Désactivez-la/s,
    );
  });

  it("supprime une évaluation jamais passée, avec ses questions", async () => {
    const id = await evaluationVide("Jamais passée");
    const api = appelEnseignant(prof);
    await api.authoring.createQuestion({ evaluationId: id, question: questionQcm() });

    await expect(api.authoring.deleteEvaluation({ id })).resolves.toEqual({ success: true });

    expect(await db.select().from(questions).where(eq(questions.evaluationId, id))).toHaveLength(0);
    await expect(api.authoring.getEvaluation({ id })).rejects.toThrow();
  });
});

describe("questions", () => {
  it("modifie une question et retient la nouvelle rédaction", async () => {
    const id = await evaluationVide("Reprise");
    const api = appelEnseignant(prof);
    const { id: questionId } = await api.authoring.createQuestion({
      evaluationId: id,
      question: questionQcm(),
    });

    await api.authoring.updateQuestion({
      id: questionId,
      question: questionQcm({
        question: "Combien font trois et trois ?",
        options: ["$5$", "$6$", "$7$", "$8$"],
        correctAnswer: "1",
        justificationRequired: true,
        tags: ["calcul"],
        difficulty: 1,
      }),
    });

    const { questions: qs } = await api.authoring.getEvaluation({ id });
    expect(qs[0].question).toContain("trois et trois");
    expect(qs[0].justificationRequired).toBe(true);
    expect(qs[0].difficulty).toBe(1);
  });

  it("supprime une question jamais corrigée", async () => {
    const id = await evaluationVide("Ménage");
    const api = appelEnseignant(prof);
    const { id: questionId } = await api.authoring.createQuestion({
      evaluationId: id,
      question: questionQcm(),
    });

    await expect(api.authoring.deleteQuestion({ id: questionId })).resolves.toEqual({
      success: true,
    });
    expect((await api.authoring.getEvaluation({ id })).questions).toHaveLength(0);
  });

  it("réordonne les questions dans l'ordre reçu", async () => {
    const id = await evaluationVide("Ordre");
    const api = appelEnseignant(prof);
    const a = await api.authoring.createQuestion({ evaluationId: id, question: questionQcm() });
    const b = await api.authoring.createQuestion({
      evaluationId: id,
      question: questionQcm({ question: "Deuxième question ?" }),
    });

    await api.authoring.reorderQuestions({ evaluationId: id, orderedIds: [b.id, a.id] });

    const rangs = await db
      .select({ id: questions.id, order: questions.order })
      .from(questions)
      .where(eq(questions.evaluationId, id))
      .orderBy(asc(questions.order));
    expect(rangs.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it("refuse un réordonnancement qui n'énumère pas exactement les questions", async () => {
    const id = await evaluationVide("Ordre partiel");
    const api = appelEnseignant(prof);
    const a = await api.authoring.createQuestion({ evaluationId: id, question: questionQcm() });
    await api.authoring.createQuestion({
      evaluationId: id,
      question: questionQcm({ question: "Deuxième question ?" }),
    });

    // Une liste incomplète laisserait des questions au même rang : l'ordre
    // affiché à l'élève deviendrait celui de l'insertion, en silence.
    await expect(
      api.authoring.reorderQuestions({ evaluationId: id, orderedIds: [a.id] }),
    ).rejects.toThrow(/exactement les questions/);

    // Une liste de la bonne longueur mais qui désigne une question d'ailleurs.
    await expect(
      api.authoring.reorderQuestions({ evaluationId: id, orderedIds: [a.id, 999_999_999] }),
    ).rejects.toThrow(/exactement les questions/);
  });
});

describe("génération assistée", () => {
  /** Un modèle de théâtre qui rend la sortie demandée. */
  function modeleRepond(contenu: unknown, ok = true) {
    const corps = typeof contenu === "string" ? contenu : JSON.stringify(contenu);
    globalThis.fetch = (async (entree: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
      if (url.startsWith(env.llm.apiUrl)) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: corps }, finish_reason: "stop" }] }),
          { status: ok ? 200 : 502, headers: { "content-type": "application/json" } },
        );
      }
      return FETCH_INITIAL(entree, init);
    }) as typeof fetch;
  }

  const QCM_RENDU = {
    questions: [
      {
        question: "La limite de $f(x)=\\dfrac{3x^2}{x^2+5}$ en $+\\infty$ vaut :",
        options: ["$+\\infty$", "$0$", "$3$", "$\\dfrac{1}{5}$"],
        correctIndex: 2,
        diagnostics: [
          "Vous avez comparé les degrés sans diviser.",
          "Vous avez négligé le terme dominant du numérateur.",
          "",
          "Vous avez pris le rapport des termes constants.",
        ],
        points: 1,
        difficulty: 2,
        tags: ["limites"],
        detailedRubric: "Diviser par $x^2$.",
      },
    ],
  };

  it("annonce l'état de la configuration à l'interface", async () => {
    const etat = await appelEnseignant(prof).authoring.llmStatus();
    expect(etat.configured).toBe(true);
    expect(etat.model).toBe(env.llm.model);
    expect(typeof etat.ragAvailable).toBe("boolean");
  });

  it("annonce l'absence de modèle plutôt que de laisser l'interface deviner", async () => {
    (env.llm as { apiKey: string }).apiKey = "";
    const etat = await appelEnseignant(prof).authoring.llmStatus();
    expect(etat).toMatchObject({ configured: false, model: null });
  });

  it("propose des questions sans rien écrire en base", async () => {
    const id = await evaluationVide("Assistée");
    modeleRepond(QCM_RENDU);

    const resultat = await appelEnseignant(prof).authoring.generateQuestions({
      evaluationId: id,
      theme: "limites de fonctions rationnelles",
      count: 1,
    });

    expect(resultat.proposals).toHaveLength(1);
    expect(resultat.proposals[0].valid).toBe(true);
    expect(resultat.model).toBe(env.llm.model);
    // Rien n'entre en base sans relecture : c'est l'enseignant qui enregistre.
    expect((await appelEnseignant(prof).authoring.getEvaluation({ id })).questions).toHaveLength(0);
  });

  it("refuse de générer sans clé configurée", async () => {
    const id = await evaluationVide("Sans clé");
    (env.llm as { apiKey: string }).apiKey = "";

    await expect(
      appelEnseignant(prof).authoring.generateQuestions({ evaluationId: id, theme: "suites" }),
    ).rejects.toThrow(/LLM_API_KEY/);
  });

  it("remonte l'échec du modèle sans laisser l'enseignant devant une page muette", async () => {
    const id = await evaluationVide("Modèle en panne");
    modeleRepond("indisponible", false);

    await expect(
      appelEnseignant(prof).authoring.generateQuestions({ evaluationId: id, theme: "intégrales" }),
    ).rejects.toThrow();
  });

  it("borne le nombre de générations par enseignant", async () => {
    const gourmand = await creerEnseignant("Enseignant gourmand");
    const { id } = await appelEnseignant(gourmand).authoring.createEvaluation({
      title: unique("Quota"),
    });
    evaluationsCreees.push(id);
    modeleRepond(QCM_RENDU);
    const api = appelEnseignant(gourmand);

    // La génération coûte des jetons : douze par tranche de cinq minutes.
    for (let i = 0; i < 12; i += 1) {
      await api.authoring.generateQuestions({ evaluationId: id, theme: `thème ${i}`, count: 1 });
    }

    await expect(
      api.authoring.generateQuestions({ evaluationId: id, theme: "la treizième" }),
    ).rejects.toThrow(/Trop de générations/);

    await nettoyer([], [gourmand.id]);
  });
});
