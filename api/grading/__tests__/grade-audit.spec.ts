/**
 * Le journal des interventions sur les notes.
 *
 * Une note changée à la main doit rester défendable devant un élève ou une
 * famille : qui, quand, de quelle valeur vers quelle valeur, et pourquoi. Le
 * journal est en ajout seul — une seconde modification ajoute une ligne, elle
 * n'en corrige aucune —, et il ne doit jamais faire échouer la correction
 * qu'il trace : perdre une ligne de journal est regrettable, perdre une note
 * déjà appliquée le serait davantage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { responses } from "@db/schema";

interface Insertion { table: unknown; valeurs: Record<string, unknown> }

const etat: {
  insertions: Insertion[];
  reponses: Record<string, unknown>[];
  insertionEchoue: boolean;
} = { insertions: [], reponses: [], insertionEchoue: false };

function fauxDb() {
  return {
    insert: (table: unknown) => ({
      values: (valeurs: Record<string, unknown>) => {
        if (etat.insertionEchoue) {
          return Promise.reject(new Error("colonne inconnue « reason »"));
        }
        etat.insertions.push({ table, valeurs });
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => {
          const p = Promise.resolve(etat.reponses);
          return Object.assign(p, { limit: () => p });
        },
      }),
    }),
  };
}

vi.mock("../../queries/connection", () => ({ getDb: () => fauxDb() }));

const requestIdCourant = vi.hoisted(() => ({ valeur: undefined as string | undefined }));
vi.mock("../../lib/request-id", () => ({
  currentRequestId: () => requestIdCourant.valeur,
}));

const { recordGradeAudit, readResponseState } = await import("../grade-audit");

beforeEach(() => {
  etat.insertions = [];
  etat.reponses = [];
  etat.insertionEchoue = false;
  requestIdCourant.valeur = "req-abcdefgh";
});

const intervention = {
  sessionId: 7,
  responseId: 42,
  questionId: 13,
  actorId: 2,
  actorEmail: "prof@lycee.fr",
  action: "manual_override" as const,
  oldScore: 1,
  newScore: 0.5,
  oldMode: "symbolic:numeric",
  newMode: "manual_override",
  reason: "Révision après relecture de la copie",
};

describe("recordGradeAudit", () => {
  it("consigne l'intégralité de l'intervention", async () => {
    await recordGradeAudit(intervention);
    expect(etat.insertions).toHaveLength(1);
    const l = etat.insertions[0].valeurs;
    expect(l.sessionId).toBe(7);
    expect(l.responseId).toBe(42);
    expect(l.questionId).toBe(13);
    expect(l.actorId).toBe(2);
    expect(l.actorEmail).toBe("prof@lycee.fr");
    expect(l.action).toBe("manual_override");
    expect(l.oldMode).toBe("symbolic:numeric");
    expect(l.newMode).toBe("manual_override");
    expect(l.reason).toBe("Révision après relecture de la copie");
  });

  it("enregistre les notes en décimal, pas en nombre flottant", async () => {
    // Les colonnes sont décimales : y écrire un nombre laisserait MySQL
    // convertir, et un quart de point pourrait disparaître en route.
    await recordGradeAudit(intervention);
    const l = etat.insertions[0].valeurs;
    expect(l.oldScore).toBe("1.00");
    expect(l.newScore).toBe("0.50");
  });

  it("rattache l'identifiant de requête", async () => {
    // C'est lui qui relie une ligne de journal aux traces du serveur.
    await recordGradeAudit(intervention);
    expect(etat.insertions[0].valeurs.requestId).toBe("req-abcdefgh");
  });

  it("accepte une intervention hors requête HTTP", async () => {
    requestIdCourant.valeur = undefined;
    await recordGradeAudit(intervention);
    expect(etat.insertions[0].valeurs.requestId).toBeNull();
  });

  it("dénormalise l'adresse de l'auteur", async () => {
    // L'adresse est recopiée plutôt que jointe : la trace doit survivre à la
    // suppression du compte enseignant.
    await recordGradeAudit(intervention);
    expect(etat.insertions[0].valeurs.actorEmail).toBe("prof@lycee.fr");
  });

  it("tolère une intervention sans motif ni auteur connus", async () => {
    await recordGradeAudit({ sessionId: 7, action: "regrade" });
    const l = etat.insertions[0].valeurs;
    expect(l.reason).toBeNull();
    expect(l.actorId).toBeNull();
    expect(l.actorEmail).toBeNull();
    expect(l.oldScore).toBeNull();
    expect(l.newScore).toBeNull();
  });

  it("ajoute une ligne par intervention, sans jamais en corriger une", async () => {
    // Journal en ajout seul : la deuxième correction n'efface pas la première.
    await recordGradeAudit({ ...intervention, oldScore: 2, newScore: 1 });
    await recordGradeAudit({ ...intervention, oldScore: 1, newScore: 0.5 });
    expect(etat.insertions).toHaveLength(2);
    expect(etat.insertions[0].valeurs.oldScore).toBe("2.00");
    expect(etat.insertions[0].valeurs.newScore).toBe("1.00");
    expect(etat.insertions[1].valeurs.oldScore).toBe("1.00");
    expect(etat.insertions[1].valeurs.newScore).toBe("0.50");
  });

  it("trace les trois natures d'intervention", async () => {
    for (const action of ["manual_override", "manual_paper", "regrade"] as const) {
      await recordGradeAudit({ sessionId: 1, action });
    }
    expect(etat.insertions.map((i) => i.valeurs.action)).toEqual([
      "manual_override", "manual_paper", "regrade",
    ]);
  });

  it("ne fait jamais échouer la correction qu'il trace", async () => {
    // Une note déjà appliquée ne doit pas être perdue parce que le journal
    // refuse une ligne.
    etat.insertionEchoue = true;
    await expect(recordGradeAudit(intervention)).resolves.toBeUndefined();
  });
});

describe("readResponseState", () => {
  it("rend l'état d'avant modification", async () => {
    etat.reponses = [{
      id: 42, sessionId: 7, questionId: 13, score: "1.00", gradingMode: "symbolic:numeric",
    }];
    const avant = await readResponseState(42);
    expect(avant).toMatchObject({ id: 42, sessionId: 7, questionId: 13, gradingMode: "symbolic:numeric" });
  });

  it("rend null quand la réponse n'existe pas", async () => {
    etat.reponses = [];
    expect(await readResponseState(999)).toBeNull();
  });
});

describe("cohérence avec le schéma", () => {
  it("écrit bien dans la table du journal, pas dans les réponses", async () => {
    await recordGradeAudit(intervention);
    expect(etat.insertions[0].table).not.toBe(responses);
  });
});
