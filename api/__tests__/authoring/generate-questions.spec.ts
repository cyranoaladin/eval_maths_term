/**
 * Génération assistée de QCM.
 *
 * L'enjeu n'est pas que le modèle réponde, c'est que rien de douteux n'entre
 * en base : sortie non conforme écartée, incohérence signalée à l'enseignant,
 * et aucune écriture sans son accord.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGenerationPrompt,
  toProposal,
  generateQuestions,
  type GeneratedQcm,
} from "../../authoring/generate-questions";

const QCM_MODELE: GeneratedQcm = {
  question: "La limite de $f(x)=\\dfrac{3x^2-2x+1}{x^2+5}$ en $+\\infty$ vaut :",
  options: ["$+\\infty$", "$0$", "$3$", "$\\dfrac{1}{5}$"],
  correctIndex: 2,
  diagnostics: [
    "Vous avez comparé les degrés sans diviser : ici numérateur et dénominateur sont de même degré.",
    "Vous avez négligé le terme dominant du numérateur.",
    "",
    "Vous avez pris le rapport des termes constants au lieu des termes dominants.",
  ],
  points: 1,
  difficulty: 2,
  tags: ["limites", "formes indéterminées"],
  detailedRubric: "Diviser numérateur et dénominateur par $x^2$.",
};

function mockLLM(content: unknown, ok = true, status = 200) {
  const body = typeof content === "string" ? content : JSON.stringify(content);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status,
      text: async () => body,
      json: async () => ({ choices: [{ message: { content: body } }] }),
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("buildGenerationPrompt", () => {
  it("impose la règle des distracteurs diagnostiques", () => {
    const [systeme] = buildGenerationPrompt({ theme: "suites", count: 3, difficulty: 2 });
    expect(systeme.content).toMatch(/erreur type réelle et documentée/);
    expect(systeme.content).toMatch(/diagnostic rédigé à l'élève/);
  });

  it("interdit explicitement le distracteur fantaisiste", () => {
    const [systeme] = buildGenerationPrompt({ theme: "suites", count: 1, difficulty: 1 });
    expect(systeme.content).toMatch(/fantaisiste/);
    expect(systeme.content).toMatch(/deux capacités à la fois/);
  });

  it("reprend le thème, le niveau et la difficulté", () => {
    const [, user] = buildGenerationPrompt({
      theme: "convergence des suites", count: 5, difficulty: 3, level: "Terminale", subject: "Mathématiques",
    });
    expect(user.content).toMatch(/5 question/);
    expect(user.content).toMatch(/convergence des suites/);
    expect(user.content).toMatch(/Terminale/);
    expect(user.content).toMatch(/difficile/);
  });

  it("transmet les extraits de cours quand le RAG en fournit", () => {
    const [, user] = buildGenerationPrompt({
      theme: "logarithme", count: 1, difficulty: 2,
      contextPassages: [{ source: "Chapitre 4, p.12", text: "Pour tout $x>0$, $\\ln(x^a)=a\\ln(x)$." }],
    });
    expect(user.content).toMatch(/Chapitre 4, p.12/);
    expect(user.content).toMatch(/N'introduis aucune notion qui n'y figure pas/);
  });

  it("liste les énoncés existants pour éviter les redites", () => {
    const [, user] = buildGenerationPrompt({
      theme: "dérivation", count: 2, difficulty: 2,
      existingQuestions: ["La dérivée de $e^{2x}$ est :"],
    });
    expect(user.content).toMatch(/existent déjà/);
    expect(user.content).toMatch(/e\^\{2x\}/);
  });
});

describe("toProposal", () => {
  it("produit une question cohérente", () => {
    const p = toProposal(QCM_MODELE);
    expect(p.valid).toBe(true);
    expect(p.errors).toEqual([]);
    expect(p.draft.correctAnswer).toBe("2");
    expect(p.draft.gradingRubric.mode).toEqual({ kind: "qcm", correctIndex: 2 });
  });

  it("aligne le poids du barème sur les points", () => {
    const p = toProposal({ ...QCM_MODELE, points: 3 });
    expect(p.draft.gradingRubric.weight).toBe(3);
    expect(p.valid).toBe(true);
  });

  it("conserve les diagnostics alignés sur les propositions", () => {
    const p = toProposal(QCM_MODELE);
    const d = p.draft.gradingRubric.distractorDiagnostics!;
    expect(d).toHaveLength(4);
    expect(d[2]).toBe(""); // la bonne réponse n'a pas de diagnostic
    expect(d[0]).toMatch(/comparé les degrés/);
  });

  it("complète un tableau de diagnostics trop court plutôt que de décaler", () => {
    const p = toProposal({ ...QCM_MODELE, diagnostics: ["erreur A"] });
    const d = p.draft.gradingRubric.distractorDiagnostics!;
    expect(d).toHaveLength(4);
    expect(d[0]).toBe("erreur A");
    expect(d[3]).toBe("");
  });

  it("omet les diagnostics si le modèle n'en a fourni aucun", () => {
    const p = toProposal({ ...QCM_MODELE, diagnostics: ["", "", "", ""] });
    expect(p.draft.gradingRubric.distractorDiagnostics).toBeUndefined();
  });

  it("signale une proposition incohérente sans la jeter", () => {
    const p = toProposal({ ...QCM_MODELE, options: ["$3$", "$3$", "$0$", "$1$"] });
    expect(p.valid).toBe(false);
    expect(p.errors.join()).toMatch(/identiques/);
    expect(p.draft).toBeDefined(); // l'enseignant peut la corriger
  });
});

describe("generateQuestions", () => {
  it("retourne des propositions à partir d'une sortie conforme", async () => {
    mockLLM({ questions: [QCM_MODELE, { ...QCM_MODELE, question: "Autre énoncé de test $x$." }] });
    const r = await generateQuestions({ theme: "limites", count: 2, difficulty: 2 });
    expect(r.proposals).toHaveLength(2);
    expect(r.proposals.every((p) => p.valid)).toBe(true);
    expect(r.rejected).toEqual([]);
  });

  it("accepte une sortie encadrée par des clôtures de code", async () => {
    mockLLM("```json\n" + JSON.stringify({ questions: [QCM_MODELE] }) + "\n```");
    const r = await generateQuestions({ theme: "limites", count: 1, difficulty: 2 });
    expect(r.proposals).toHaveLength(1);
  });

  it("refuse une sortie qui n'est pas du JSON", async () => {
    mockLLM("Voici trois questions : 1) ...");
    await expect(
      generateQuestions({ theme: "limites", count: 1, difficulty: 2 }),
    ).rejects.toThrow(/pas renvoyé de JSON exploitable/);
  });

  it("refuse une sortie qui ne respecte pas le contrat", async () => {
    mockLLM({ questions: [{ question: "trop court", options: ["a"] }] });
    await expect(
      generateQuestions({ theme: "limites", count: 1, difficulty: 2 }),
    ).rejects.toThrow(/non conforme/);
  });

  it("écarte une question dont la bonne réponse n'existe pas", async () => {
    mockLLM({ questions: [{ ...QCM_MODELE, correctIndex: 9 }] });
    const r = await generateQuestions({ theme: "limites", count: 1, difficulty: 2 });
    expect(r.proposals).toHaveLength(0);
    expect(r.rejected[0]).toMatch(/absente/);
  });

  it("laisse passer une proposition incohérente en la signalant", async () => {
    mockLLM({ questions: [{ ...QCM_MODELE, options: ["$3$", "$3$", "$0$", "$1$"] }] });
    const r = await generateQuestions({ theme: "limites", count: 1, difficulty: 2 });
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].valid).toBe(false);
  });
});

describe("réponse tronquée", () => {
  it("signale la coupure au lieu d'un « JSON invalide » trompeur", async () => {
    // Les modèles à raisonnement consomment le budget avant d'écrire : la
    // coupure se manifestait par un JSON incomplet, message inexploitable.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          choices: [{ message: { content: '{"questions":[{"question":"Pour quelles val' }, finish_reason: "length" }],
          usage: { completion_tokens: 1900, completion_tokens_details: { reasoning_tokens: 830 } },
        }),
      }),
    );

    await expect(
      generateQuestions({ theme: "suites", count: 2, difficulty: 2 }),
    ).rejects.toThrow(/coupée par le plafond de jetons.*830 de raisonnement/s);
  });

  it("le budget croît avec le nombre de questions demandées", async () => {
    const appels: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: { body: string }) => {
        appels.push(JSON.parse(init.body).max_tokens);
        return Promise.resolve({
          ok: true, status: 200, text: async () => "",
          json: async () => ({ choices: [{ message: { content: JSON.stringify({ questions: [QCM_MODELE] }) }, finish_reason: "stop" }] }),
        });
      }),
    );

    await generateQuestions({ theme: "t", count: 1, difficulty: 2 });
    await generateQuestions({ theme: "t", count: 5, difficulty: 2 });
    expect(appels[1]).toBeGreaterThan(appels[0]);
    // Le raisonnement domine et ne suit pas le nombre de questions : mesuré
    // jusqu'à 3 460 jetons pour une seule question difficile.
    expect(appels[0]).toBeGreaterThan(5000);
  });
});

describe("tolérance sur les champs sans effet sur la note", () => {
  it("ramène une difficulté hors barème dans les bornes", async () => {
    mockLLM({ questions: [{ ...QCM_MODELE, difficulty: 7 }] });
    const r = await generateQuestions({ theme: "t", count: 1, difficulty: 3 });
    expect(r.proposals[0].draft.difficulty).toBe(3);
  });

  it("coupe un diagnostic trop long plutôt que de perdre la question", async () => {
    const bavard = "Erreur : ".padEnd(900, "x");
    mockLLM({ questions: [{ ...QCM_MODELE, diagnostics: [bavard, "", "", ""] }] });
    const r = await generateQuestions({ theme: "t", count: 1, difficulty: 2 });
    const d = r.proposals[0].draft.gradingRubric.distractorDiagnostics!;
    expect(d[0].length).toBeLessThanOrEqual(600);
    expect(d[0].endsWith("…")).toBe(true);
  });

  it("supporte l'absence des champs facultatifs", async () => {
    mockLLM({
      questions: [{
        question: QCM_MODELE.question, options: QCM_MODELE.options, correctIndex: 2,
      }],
    });
    const r = await generateQuestions({ theme: "t", count: 1, difficulty: 2 });
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].valid).toBe(true);
    expect(r.proposals[0].draft.points).toBe(1);
  });

  it("reste strict sur ce qui décide de la note", async () => {
    // Un index de bonne réponse absent des propositions fausserait la correction.
    mockLLM({ questions: [{ ...QCM_MODELE, correctIndex: 12 }] });
    const r = await generateQuestions({ theme: "t", count: 1, difficulty: 2 });
    expect(r.proposals).toHaveLength(0);
    expect(r.rejected[0]).toMatch(/absente/);

    // Un énoncé vide reste refusé.
    mockLLM({ questions: [{ ...QCM_MODELE, question: "" }] });
    await expect(generateQuestions({ theme: "t", count: 1, difficulty: 2 })).rejects.toThrow(/non conforme/);
  });
});

describe("cohérence des limites", () => {
  it("un diagnostic tronqué reste accepté par le schéma de rubric", async () => {
    // Régression : la troncature coupait à 600 alors que le schéma exigeait
    // 400. Toute proposition entre les deux était déclarée incohérente, avec
    // un motif incompréhensible pour l'enseignant.
    const long = "Erreur : ".padEnd(2000, "détail ");
    mockLLM({ questions: [{ ...QCM_MODELE, diagnostics: [long, "", "", ""] }] });
    const r = await generateQuestions({ theme: "t", count: 1, difficulty: 2 });
    expect(r.proposals[0].valid).toBe(true);
    expect(r.proposals[0].errors).toEqual([]);
  });
});
