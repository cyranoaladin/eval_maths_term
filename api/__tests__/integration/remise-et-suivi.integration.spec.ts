/**
 * L'ouverture d'une copie, son suivi, sa remise.
 *
 * C'est le chemin qu'emprunte chaque élève, et ses embranchements les moins
 * fréquents sont ceux qui coûtent le plus cher : un candidat qui s'acharne,
 * un changement d'appareil en cours d'épreuve, une réponse corrigée avant la
 * remise, un temps dépassé, un relevé consulté après coup.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  appelAnonyme, appelEleve, appelEnseignant, creerEnseignant, creerEvaluation,
  db, nettoyer, ouvrirSession, unique,
} from "./harnais";
import { cheatEvents, evaluations, questions, responses, sessions } from "@db/schema";
import type { User } from "@db/schema";
import { signResultsToken } from "../../anticheat/session-token";
import type { FingerprintComponents } from "@contracts/fingerprint-canonical";

/** Un poste plausible, tel que le client le décrit. */
const POSTE: FingerprintComponents = {
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/141.0",
  language: "fr-FR",
  languages: ["fr-FR", "fr"],
  screen: { width: 1920, height: 1080, colorDepth: 24, devicePixelRatio: 1 },
  timezone: "Europe/Paris",
  timezoneOffset: -60,
  hardwareConcurrency: 8,
  platform: "Linux x86_64",
  canvasHash: "a1b2c3d4",
  webglRenderer: "Mesa Intel(R) UHD Graphics",
};

let prof: User;
let evaluationId = 0;
let questionIds: number[] = [];
const evaluationsCreees: number[] = [];

/** Une requête telle que le serveur la reçoit, avec son adresse d'origine. */
function contexteDepuis(ip: string) {
  return {
    req: new Request("http://localhost/api/trpc", { headers: { "x-forwarded-for": ip } }),
    resHeaders: new Headers(),
    requestId: "test-remise",
  };
}

async function appelDepuis(ip: string) {
  const { appRouter } = await import("../../router");
  return appRouter.createCaller(contexteDepuis(ip));
}

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant remise");
  const ev = await creerEvaluation(prof, "Remise");
  evaluationId = ev.evaluationId;
  questionIds = ev.questionIds;
  evaluationsCreees.push(evaluationId);
});

afterAll(async () => {
  await nettoyer(evaluationsCreees, [prof.id]);
});

describe("ouverture d'une copie", () => {
  it("ouvre une session et rend de quoi tenir le minuteur", async () => {
    const api = await appelDepuis("203.0.113.10");

    const ouverte = await api.session.start({
      evaluationId,
      studentName: unique("Aïcha Benkhelifa"),
      studentEmail: "aicha@exemple.test",
      fingerprintComponents: POSTE,
    });

    expect(ouverte.sessionId).toBeGreaterThan(0);
    expect(ouverte.sessionToken.split(".")).toHaveLength(3);
    // Le client compare son horloge à celle du serveur : c'est le serveur qui
    // décide de la fin, pas le poste de l'élève.
    expect(new Date(ouverte.expiresAt).getTime()).toBeGreaterThan(
      new Date(ouverte.serverTime).getTime(),
    );

    const [posee] = await db.select().from(sessions).where(eq(sessions.id, ouverte.sessionId));
    expect(posee.ipAddress).toBe("203.0.113.10");
    // L'empreinte du poste est réduite à un condensat : elle sert à repérer un
    // changement d'appareil, pas à décrire la machine.
    expect(posee.fingerprintHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignore une empreinte mal formée sans refuser l'élève", async () => {
    const api = await appelDepuis("203.0.113.11");

    const ouverte = await api.session.start({
      evaluationId,
      studentName: unique("Empreinte douteuse"),
      fingerprintComponents: { ecran: 12345 },
    });

    const [posee] = await db.select().from(sessions).where(eq(sessions.id, ouverte.sessionId));
    // Une empreinte illisible n'empêche pas de composer : la surveillance est
    // secondaire, l'épreuve ne l'est pas.
    expect(posee.fingerprintHash).toBeNull();
  });

  it("refuse une évaluation inactive", async () => {
    const [ev] = await db.insert(evaluations).values({
      title: unique("Fermée"),
      duration: 30,
      isActive: false,
      ownerId: prof.id,
    });
    const fermee = Number(ev.insertId);
    evaluationsCreees.push(fermee);
    const api = await appelDepuis("203.0.113.12");

    await expect(
      api.session.start({ evaluationId: fermee, studentName: "Élève trop tôt" }),
    ).rejects.toThrow(/introuvable ou inactive/);
  });

  it("borne un même nom qui s'acharne, sans bloquer le reste de la salle", async () => {
    const insistant = unique("Élève insistant");
    const api = await appelDepuis("203.0.113.20");

    for (let i = 0; i < 5; i += 1) {
      await api.session.start({ evaluationId, studentName: insistant });
    }
    await expect(
      api.session.start({ evaluationId, studentName: insistant }),
    ).rejects.toThrow(/Trop de tentatives pour ce nom/);

    // La limite vise la personne, pas la salle : un camarade sur la même
    // adresse ouvre normalement.
    await expect(
      api.session.start({ evaluationId, studentName: unique("Sa voisine") }),
    ).resolves.toMatchObject({ sessionId: expect.any(Number) });
  });
});

describe("plafond par réseau", () => {
  it("refuse une ouverture de plus quand le réseau a atteint son plafond", async () => {
    // Le plafond par adresse est dimensionné pour un établissement entier. On
    // le remplit ici sans ouvrir six cents copies : le compteur est le même,
    // qu'il soit incrémenté par une requête ou directement.
    const { checkRateLimit, RateLimits } = await import("../../lib/rate-limit");
    const ip = "198.51.100.200";
    for (let i = 0; i < RateLimits.sessionStartPerIp.max; i += 1) {
      checkRateLimit(
        `session-start-ip:${ip}`,
        RateLimits.sessionStartPerIp.max,
        RateLimits.sessionStartPerIp.windowMs,
      );
    }
    const api = await appelDepuis(ip);

    await expect(
      api.session.start({ evaluationId, studentName: unique("Élève de trop") }),
    ).rejects.toThrow(/Trop d'ouvertures simultanées depuis ce réseau/);
  });
});

describe("suivi pendant l'épreuve", () => {
  it("consigne un changement d'appareil comme un incident", async () => {
    const api = await appelDepuis("203.0.113.30");
    const { sessionId, sessionToken } = await api.session.start({
      evaluationId,
      studentName: unique("Élève mobile"),
      fingerprintComponents: POSTE,
    });

    const { appRouter } = await import("../../router");
    const eleve = appRouter.createCaller({
      req: new Request("http://localhost/api/trpc", {
        headers: { "x-student-session-token": sessionToken, "x-forwarded-for": "198.51.100.7" },
      }),
      resHeaders: new Headers(),
      requestId: "test-remise",
    });

    const battement = await eleve.session.heartbeat({
      clientTime: Date.now(),
      focused: true,
      currentQuestionIndex: 1,
      fingerprintHash: "0000000000000000000000000000000000000000000000000000000000000000",
    });

    expect(battement.fingerprintMismatch).toBe(true);
    expect(battement.ipMismatch).toBe(true);
    expect(battement.status).toBe("in_progress");

    // L'incident est consigné côté serveur : c'est ce que l'enseignant verra.
    const incidents = await db
      .select({ type: cheatEvents.type })
      .from(cheatEvents)
      .where(eq(cheatEvents.sessionId, sessionId));
    expect(incidents.map((i) => i.type).sort()).toEqual(["fingerprint_mismatch", "multi_device"]);
  });

  it("borne la fréquence des battements", async () => {
    const { jeton } = await ouvrirSession(evaluationId, unique("Élève pressé"));
    const api = appelEleve(jeton);
    const { RateLimits } = await import("../../lib/rate-limit");

    for (let i = 0; i < RateLimits.heartbeat.max; i += 1) {
      await api.session.heartbeat({
        clientTime: Date.now(),
        focused: true,
        currentQuestionIndex: 0,
        fingerprintHash: "abc",
      });
    }

    await expect(
      api.session.heartbeat({
        clientTime: Date.now(),
        focused: true,
        currentQuestionIndex: 0,
        fingerprintHash: "abc",
      }),
    ).rejects.toThrow(/Trop de heartbeats/);
  });
});

describe("remise", () => {
  it("corrige une réponse changée avant la remise sans la dupliquer", async () => {
    const { sessionId, jeton } = await ouvrirSession(evaluationId, unique("Élève hésitant"));
    const api = appelEleve(jeton);

    // Deux réponses sont déjà en base — l'élève avait répondu, puis s'est
    // ravisé avant de rendre. La seconde ne change que sa justification.
    await db.insert(responses).values({
      sessionId,
      questionId: questionIds[0],
      answer: "0",
      maxScore: 0,
      partialCreditApplied: false,
    });
    await db.insert(responses).values({
      sessionId,
      questionId: questionIds[1],
      answer: "false",
      justification: "Un premier jet.",
      maxScore: 0,
      partialCreditApplied: false,
    });

    const rendu = await api.session.submit({
      answers: [
        { questionId: questionIds[0], answer: "1" },
        { questionId: questionIds[1], answer: "false", justification: "La fonction décroît sur les négatifs." },
      ],
      timeSpent: 600,
    });

    expect(rendu.success).toBe(true);
    const ecrites = await db
      .select()
      .from(responses)
      .where(eq(responses.sessionId, sessionId));
    // Deux réponses, pas trois : celle qui existait a été reprise.
    expect(ecrites).toHaveLength(2);
    expect(ecrites.find((r) => r.questionId === questionIds[0])!.answer).toBe("1");
    // La justification reprise remplace la précédente : c'est elle que
    // l'enseignant lira.
    expect(ecrites.find((r) => r.questionId === questionIds[1])!.justification).toBe(
      "La fonction décroît sur les négatifs.",
    );
    expect(rendu.totalScore).toBeGreaterThan(0);
  });

  it("écarte une réponse qui ne concerne pas cette évaluation", async () => {
    const autre = await creerEvaluation(prof, "Évaluation voisine");
    evaluationsCreees.push(autre.evaluationId);
    const { sessionId, jeton } = await ouvrirSession(evaluationId, unique("Élève curieux"));

    await appelEleve(jeton).session.submit({
      answers: [
        { questionId: questionIds[0], answer: "1" },
        // La question d'une autre copie : elle ne doit pas entrer ici.
        { questionId: autre.questionIds[0], answer: "1" },
      ],
    });

    const ecrites = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
    expect(ecrites.map((r) => r.questionId)).toEqual([questionIds[0]]);
  });

  it("marque une copie rendue au temps dépassé", async () => {
    const { sessionId, jeton } = await ouvrirSession(evaluationId, unique("Élève dépassé"));

    await appelEleve(jeton).session.submit({
      answers: [{ questionId: questionIds[0], answer: "1" }],
      isTimeout: true,
    });

    const [apres] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(apres.status).toBe("timed_out");
  });

  it("marque une copie dont la surveillance a relevé trop d'incidents", async () => {
    const { sessionId, jeton } = await ouvrirSession(evaluationId, unique("Élève signalé"));
    // Un changement d'appareil et l'ouverture des outils de développement :
    // pris ensemble, ils dépassent le seuil du verdict le plus grave.
    for (const type of ["multi_device", "devtools_open"] as const) {
      await db.insert(cheatEvents).values({ sessionId, type, timestamp: new Date() });
    }

    // L'index soumis est celui de l'ordre affiché à l'élève, pas celui de la
    // base : le mélange dépend de l'identifiant de la question, qui change à
    // chaque exécution.
    const eleve = appelEleve(jeton);
    const qs = await eleve.question.getForActiveSession();
    const qcm = qs.find((q) => q.type === "qcm")!;
    await eleve.session.submit({
      answers: [{ questionId: qcm.id, answer: String(qcm.options!.indexOf("$4$")) }],
    });

    const [apres] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(apres.status).toBe("cheating_detected");
    expect(apres.suspicionVerdict).toBe("severe");
    // La copie est corrigée quand même : c'est l'enseignant qui tranche, pas
    // le compteur d'incidents.
    expect(Number(apres.totalScore)).toBeGreaterThan(0);
  });

  it("rend la même chose à une remise rejouée", async () => {
    const { jeton } = await ouvrirSession(evaluationId, unique("Élève coupé"));
    const api = appelEleve(jeton);

    const premier = await api.session.submit({
      answers: [{ questionId: questionIds[0], answer: "1" }],
      timeSpent: 300,
    });
    const second = await api.session.submit({
      answers: [{ questionId: questionIds[0], answer: "0" }],
    });

    // Mêmes points, même jeton : la seconde requête ne réécrit rien.
    expect(second).toEqual(premier);
  });

  it("rend un jeton de résultats même à une copie remise sans lui", async () => {
    const { sessionId, jeton } = await ouvrirSession(evaluationId, unique("Élève interrompu"));
    // Une copie close par le balayage d'inactivité avant que le jeton existe.
    await db
      .update(sessions)
      .set({ status: "timed_out", endedAt: new Date(), resultsToken: null })
      .where(eq(sessions.id, sessionId));

    const rendu = await appelEleve(jeton).session.submit({ answers: [] });

    expect(rendu.resultsToken).toBeTruthy();
    // Sans ce jeton, l'élève ne peut pas consulter la copie qu'il a rendue.
    await expect(
      appelAnonyme().session.getResults({ resultsToken: rendu.resultsToken }),
    ).resolves.toMatchObject({ sessionId });
  });
});

describe("consultation des résultats", () => {
  it("refuse un jeton illisible", async () => {
    await expect(
      appelAnonyme().session.getResults({ resultsToken: "pas-un-jeton" }),
    ).rejects.toThrow(/invalide ou expiré/);
  });

  it("refuse un jeton qui désigne une copie disparue", async () => {
    const jeton = await signResultsToken(999_999_999);
    await expect(
      appelAnonyme().session.getResults({ resultsToken: jeton }),
    ).rejects.toThrow(/Session introuvable/);
  });

  it("rend la copie corrigée, avec le compte des incidents", async () => {
    const { sessionId, jeton } = await ouvrirSession(evaluationId, unique("Élève relu"));
    await db.insert(cheatEvents).values({
      sessionId,
      type: "tab_switch",
      timestamp: new Date(),
    });
    const rendu = await appelEleve(jeton).session.submit({
      answers: [{ questionId: questionIds[0], answer: "1" }],
    });

    const releve = await appelAnonyme().session.getResults({
      resultsToken: rendu.resultsToken,
    });

    expect(releve).toMatchObject({ sessionId, cheatEventCount: 1 });
    expect(releve.responses[0].score).toBeTypeOf("number");
  });

  it("rend à l'enseignant le détail d'une copie, propositions comprises", async () => {
    const { sessionId, jeton } = await ouvrirSession(evaluationId, unique("Élève détaillé"));
    await appelEleve(jeton).session.submit({
      answers: [
        { questionId: questionIds[0], answer: "1" },
        // Un vrai/faux ne porte aucune proposition en base : l'écran ne doit
        // pas en inventer, ni buter sur leur absence.
        { questionId: questionIds[1], answer: "false" },
      ],
    });
    // Selon la version et le pilote, MySQL rend le JSON décodé ou en chaîne.
    // L'écran de correction doit afficher les propositions dans les deux cas :
    // ici telles qu'elles sont rangées, plus bas une fois décodées.
    const brut = await appelEnseignant(prof).session.getDetailsForTeacher({ sessionId });
    expect(brut.responses.find((r) => r.questionId === questionIds[0])!.options).toHaveLength(4);

    await db
      .update(questions)
      .set({ options: ["$3$", "$4$", "$5$", "$6$"] as never })
      .where(eq(questions.id, questionIds[0]));

    const detail = await appelEnseignant(prof).session.getDetailsForTeacher({ sessionId });

    expect(detail.responses[0].options).toHaveLength(4);
    // La bonne réponse accompagne la question : c'est l'écran de correction de
    // l'enseignant, le seul endroit où elle a sa place.
    expect(detail.responses[0].question).toHaveProperty("correctAnswer");
    expect(detail.responses.find((r) => r.questionId === questionIds[1])!.options).toBeNull();
  });

  it("refuse à l'enseignant le détail d'une copie qui n'existe pas", async () => {
    await expect(
      appelEnseignant(prof).session.getDetailsForTeacher({ sessionId: 999_999_999 }),
    ).rejects.toThrow();
  });
});
