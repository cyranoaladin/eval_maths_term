/**
 * Le client de correction assistée, quand il ne peut pas travailler.
 *
 * Le LLM est facultatif dans cette plateforme : sans clef, la correction
 * déterministe doit continuer et l'appel doit échouer proprement, jamais
 * silencieusement. Et une réponse mal formée du service ne doit pas se
 * transformer en note.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const configure = vi.hoisted(() => ({ valeur: true }));
const reponse = vi.hoisted(() => ({ contenu: "" }));

vi.mock("../../llm/chat", async (importer) => {
  const reel = await importer<typeof import("../../llm/chat")>();
  return {
    ...reel,
    isLlmConfigured: () => configure.valeur,
    // Le transport n'est pas l'objet du test : ce qui compte est ce que le
    // client fait de ce que le service lui rend.
    chatCompletion: async () => reponse.contenu,
    withRetry: async <T>(fn: () => Promise<T>) => fn(),
  };
});

const { gradeWithLLM } = await import("../llm-client");

const args = {
  question: "Calculez la limite.",
  expectedAnswer: "2",
  studentAnswer: "2",
  questionType: "short_answer" as const,
  maxPoints: 2,
  detailedRubric: "Valeur exacte attendue.",
};

beforeEach(() => {
  configure.valeur = true;
  reponse.contenu = "";
});

/** Simule une réponse du service, avec le contenu voulu. */
function repond(contenu: string) {
  reponse.contenu = contenu;
}

describe("gradeWithLLM", () => {
  it("refuse d'appeler un service non configuré", async () => {
    // Sans clef, l'appel doit échouer tout de suite : le moteur déterministe
    // sait quoi faire d'un échec, pas d'une réponse vide.
    configure.valeur = false;
    await expect(gradeWithLLM(args)).rejects.toThrow(/non configurée/i);
  });

  it("refuse une réponse qui n'est pas du JSON", async () => {
    repond("Je pense que la réponse est correcte, bravo !");
    await expect(gradeWithLLM({ ...args, studentAnswer: "réponse-json-invalide" }))
      .rejects.toThrow(/JSON valide/i);
  });

  it("accepte une réponse encadrée par des balises de code", async () => {
    // Les modèles enrobent volontiers leur JSON dans un bloc ```json.
    repond('```json\n{"score": 2, "feedback": "Correct.", "confidence": 0.9}\n```');
    const r = await gradeWithLLM({ ...args, studentAnswer: "réponse-balisée" });
    expect(r.score).toBe(2);
    expect(r.feedback).toBe("Correct.");
  });

  it("refuse une réponse dont la structure ne correspond pas au contrat", async () => {
    repond('{"note": "bien"}');
    await expect(gradeWithLLM({ ...args, studentAnswer: "réponse-hors-contrat" }))
      .rejects.toThrow();
  });
});
