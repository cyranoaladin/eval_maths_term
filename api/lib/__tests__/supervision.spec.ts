/**
 * Ce qui part vers la supervision, et surtout ce qui n'en part jamais.
 *
 * Une copie d'élève est une donnée scolaire : nom, réponses, notes, incidents
 * de surveillance. Rien de tout cela n'a sa place chez un tiers. Un jeton de
 * session non plus — le transmettre reviendrait à donner l'accès avec le
 * rapport.
 *
 * Ces tests portent sur le nettoyage, pas sur l'envoi : c'est le nettoyage qui
 * peut trahir, et il doit tenir même sur ce que personne n'a prévu.
 */
import { describe, it, expect } from "vitest";
import type { ErrorEvent } from "@sentry/node";
import {
  nettoyerEvenement,
  nettoyerTexte,
  nettoyerValeur,
} from "../supervision";

/*
  Un jeton fabriqué pour ce test. Il n'ouvre rien : sa signature ne correspond à
  aucun secret, et il ne provient d'aucune session. C'est précisément le motif
  qu'on veut voir disparaître au nettoyage — l'écrire autrement rendrait le test
  moins fidèle, et le cacher au détecteur par un assemblage de morceaux serait
  la mauvaise sorte de ruse.
*/
const JETON =
  "eyJhbGciOiJIUzI1NiJ9.eyJzZXNzaW9uSWQiOjQyLCJleHAiOjE3ODgxMTF9.y0JF5ecVILDjIrIZ90edKRUb1CMXUT7vFPyfEBfXrw"; // gitleaks:allow

describe("nettoyage du texte", () => {
  it("retire un jeton trouvé au milieu d'un message", () => {
    const propre = nettoyerTexte(`échec de vérification pour ${JETON} sur /api/trpc`);
    expect(propre).not.toContain("eyJ");
    expect(propre).toContain("/api/trpc");
  });

  it("retire l'utilisateur et le mot de passe d'une adresse de base", () => {
    const propre = nettoyerTexte(
      "connexion refusée : mysql://eval:s3cr3t@10.0.0.4:3306/eval_maths",
    );
    expect(propre).not.toContain("s3cr3t");
    expect(propre).not.toContain("eval:");
    expect(propre).toContain("mysql://");
  });

  it("laisse intact ce qui n'a rien à cacher", () => {
    const message = "Tirage 12 introuvable pour l'évaluation 3";
    expect(nettoyerTexte(message)).toBe(message);
  });
});

describe("nettoyage des données jointes", () => {
  it("retire les clés qui portent un secret, quel que soit leur nom", () => {
    const propre = nettoyerValeur({
      sessionToken: JETON,
      APP_SECRET: "abc",
      authorization: "Bearer x",
      cookie: "kimi_sid=y",
      apiKey: "z",
      requestId: "trace-1234",
    }) as Record<string, string>;

    expect(Object.values(propre).filter((v) => v === "[retiré]")).toHaveLength(5);
    // L'identifiant de requête reste : c'est lui qui mène aux journaux.
    expect(propre.requestId).toBe("trace-1234");
  });

  it("retire ce qui désigne un élève", () => {
    const propre = nettoyerValeur({
      studentName: "Durand Léa",
      email: "lea@exemple.fr",
      answer: "\\frac{1}{2}",
      justification: "parce que la fonction est continue",
      ipAddress: "10.0.0.7",
      fingerprintHash: "a1b2",
      sessionId: 42,
    }) as Record<string, unknown>;

    expect(propre.studentName).toBe("[retiré]");
    expect(propre.email).toBe("[retiré]");
    expect(propre.answer).toBe("[retiré]");
    expect(propre.justification).toBe("[retiré]");
    expect(propre.ipAddress).toBe("[retiré]");
    expect(propre.fingerprintHash).toBe("[retiré]");
    // L'identifiant technique reste : il ne désigne personne à lui seul.
    expect(propre.sessionId).toBe(42);
  });

  it("descend dans les objets imbriqués", () => {
    const propre = nettoyerValeur({
      contexte: { requete: { headers: { authorization: JETON } } },
    }) as { contexte: { requete: { headers: string } } };
    expect(JSON.stringify(propre)).not.toContain("eyJ");
  });

  it("ne boucle pas sur une structure profonde", () => {
    let profond: Record<string, unknown> = { fin: "ok" };
    for (let i = 0; i < 40; i++) profond = { niveau: profond };
    expect(() => nettoyerValeur(profond)).not.toThrow();
  });
});

describe("nettoyage d'un événement complet", () => {
  it("retire le corps, les en-têtes et l'utilisateur de la requête", () => {
    const evenement = {
      message: `échec avec ${JETON}`,
      request: {
        method: "POST",
        url: "https://qcm.exemple.fr/api/trpc/session.submit",
        data: { answers: [{ questionId: 1, answer: "\\frac12" }] },
        headers: { authorization: `Bearer ${JETON}`, cookie: "kimi_sid=abc" },
        cookies: "kimi_sid=abc",
      },
      user: { id: "u-1", email: "lea@exemple.fr" },
      breadcrumbs: [{ message: `saisie : ${JETON}` }],
      extra: { studentName: "Durand Léa", requestId: "trace-1" },
    } as unknown as ErrorEvent;

    const propre = nettoyerEvenement(evenement)!;
    const serialise = JSON.stringify(propre);

    expect(serialise).not.toContain("eyJ");
    expect(serialise).not.toContain("Durand");
    expect(serialise).not.toContain("lea@exemple.fr");
    expect(serialise).not.toContain("frac12");
    expect(propre.user).toBeUndefined();
    expect(propre.breadcrumbs).toBeUndefined();

    // Ce qui reste sert au diagnostic.
    expect(propre.request?.method).toBe("POST");
    expect(propre.request?.url).toContain("session.submit");
    expect((propre.extra as Record<string, unknown>).requestId).toBe("trace-1");
  });

  it("nettoie aussi le message porté par l'exception", () => {
    const evenement = {
      exception: {
        values: [{ type: "Error", value: `jeton refusé : ${JETON}` }],
      },
    } as unknown as ErrorEvent;

    const propre = nettoyerEvenement(evenement)!;
    expect(JSON.stringify(propre)).not.toContain("eyJ");
  });
});

describe("ce que le nettoyage traverse sans s'y perdre", () => {
  it("nettoie les contextes et les étiquettes comme les données jointes", () => {
    const nettoye = nettoyerEvenement({
      contexts: { copie: { studentName: "Aïcha", sessionId: 12 } },
      tags: { studentEmail: "aicha@exemple.test", route: "session.submit" },
    } as unknown as ErrorEvent) as unknown as {
      contexts: { copie: Record<string, unknown> };
      tags: Record<string, unknown>;
    };

    expect(nettoye.contexts.copie.studentName).toBe("[retiré]");
    expect(nettoye.contexts.copie.sessionId).toBe(12);
    expect(nettoye.tags.studentEmail).toBe("[retiré]");
    // Ce qui n'identifie personne survit : c'est ce qui rend le rapport utile.
    expect(nettoye.tags.route).toBe("session.submit");
  });

  it("s'arrête avant de descendre indéfiniment", () => {
    // Une structure qui se contient elle-même ne doit pas faire tourner le
    // nettoyage sans fin au moment d'envoyer une erreur.
    const boucle: Record<string, unknown> = {};
    boucle.soi = boucle;

    const nettoye = nettoyerValeur(boucle) as Record<string, unknown>;

    let profondeur = 0;
    let courant: unknown = nettoye;
    while (courant && typeof courant === "object" && "soi" in courant) {
      courant = (courant as Record<string, unknown>).soi;
      profondeur += 1;
      if (profondeur > 20) break;
    }
    expect(profondeur).toBeLessThanOrEqual(10);
    expect(courant).toBe("[retiré]");
  });

  it("laisse intacts les nombres, les booléens et l'absence de valeur", () => {
    expect(nettoyerValeur(42)).toBe(42);
    expect(nettoyerValeur(true)).toBe(true);
    expect(nettoyerValeur(null)).toBeNull();
    expect(nettoyerValeur(undefined)).toBeUndefined();
  });
});
