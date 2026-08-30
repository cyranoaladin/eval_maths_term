/**
 * Le socle : conversions, adresses, journal, garde CSRF, limitation.
 *
 * Rien d'ambitieux, et c'est précisément le problème que ces cas adressent :
 * ces fonctions sont appelées partout, leurs chemins de repli ne l'étaient
 * jamais, et un repli qui se trompe est silencieux. Une note relue « NaN », un
 * cookie posé sur la mauvaise adresse, une ligne de journal sans identifiant de
 * requête : rien de tout cela ne lève d'erreur.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { toNumber, toNumberOr, toDecimal } from "../decimal";
import { baseUrlPublique } from "../base-url";
import { checkOrigin, csrfMiddleware } from "../csrf";
import { checkRateLimit, purgerCompteursExpires } from "../rate-limit";
import { env } from "../env";

type EnvMutable = { isProduction: boolean; publicBaseUrl: string };
const initial = { isProduction: env.isProduction, publicBaseUrl: env.publicBaseUrl };

afterEach(() => {
  (env as unknown as EnvMutable).isProduction = initial.isProduction;
  (env as unknown as EnvMutable).publicBaseUrl = initial.publicBaseUrl;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("valeurs décimales de la base", () => {
  it("convertit ce que le pilote rend en chaîne", () => {
    expect(toNumber("1.50")).toBe(1.5);
    expect(toNumber(2.25)).toBe(2.25);
  });

  it("rend null plutôt qu'un NaN pour une valeur illisible", () => {
    // Un NaN se propage en silence jusque dans une moyenne de classe.
    expect(toNumber("pas un nombre")).toBeNull();
    expect(toNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });

  it("substitue la valeur de repli quand il n'y a rien à lire", () => {
    expect(toNumberOr(null, 0)).toBe(0);
    expect(toNumberOr("abc", -1)).toBe(-1);
    expect(toNumberOr("3.5", 0)).toBe(3.5);
  });

  it("écrit deux décimales, comme la colonne les attend", () => {
    expect(toDecimal(1.5)).toBe("1.50");
    expect(toDecimal(0.125)).toBe("0.13");
  });
});

describe("adresse publique", () => {
  const requete = () => new Request("http://poste-de-dev.local:3000/api/oauth/start");

  it("hors production, préfère l'adresse configurée si elle existe", () => {
    (env as unknown as EnvMutable).isProduction = false;
    (env as unknown as EnvMutable).publicBaseUrl = "https://atelier.exemple.fr";

    expect(baseUrlPublique(requete())).toBe("https://atelier.exemple.fr");
  });

  it("hors production et sans configuration, se déduit de la requête", () => {
    (env as unknown as EnvMutable).isProduction = false;
    (env as unknown as EnvMutable).publicBaseUrl = "";

    expect(baseUrlPublique(requete())).toBe("http://poste-de-dev.local:3000");
  });
});

describe("garde CSRF", () => {
  const mutation = (entetes: Record<string, string> = {}) =>
    new Request("http://localhost:3000/api/trpc/session.submit", {
      method: "POST",
      headers: entetes,
    });

  it("refuse en production une mutation sans en-tête Origin", () => {
    (env as unknown as EnvMutable).isProduction = true;

    // Hors navigateur, l'en-tête manque : en production, c'est un refus.
    expect(() => checkOrigin(mutation())).toThrow(/Origin absent/);
  });

  it("laisse passer une lecture sans rien vérifier", async () => {
    (env as unknown as EnvMutable).isProduction = true;
    const suite = vi.fn().mockResolvedValue(new Response("ok"));

    const reponse = await csrfMiddleware(
      new Request("http://localhost:3000/api/ready"),
      suite,
    );

    expect(reponse.status).toBe(200);
    expect(suite).toHaveBeenCalled();
  });

  it("répond 403 sans appeler la suite quand l'origine est étrangère", async () => {
    const suite = vi.fn().mockResolvedValue(new Response("ok"));

    const reponse = await csrfMiddleware(
      mutation({ origin: "https://site-tiers.exemple" }),
      suite,
    );

    expect(reponse.status).toBe(403);
    await expect(reponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("non autorisée"),
    });
    expect(suite).not.toHaveBeenCalled();
  });

  it("couvre aussi PUT et DELETE, pas seulement POST", async () => {
    for (const method of ["PUT", "DELETE"]) {
      const suite = vi.fn().mockResolvedValue(new Response("ok"));
      const reponse = await csrfMiddleware(
        new Request("http://localhost:3000/api/trpc/x", {
          method,
          headers: { origin: "https://site-tiers.exemple" },
        }),
        suite,
      );
      expect(reponse.status).toBe(403);
    }
  });
});

describe("limitation de débit", () => {
  it("compte les appels dans la fenêtre puis refuse", () => {
    const cle = `test-${Math.random()}`;
    for (let i = 0; i < 3; i += 1) expect(checkRateLimit(cle, 3, 60_000)).toBe(true);
    expect(checkRateLimit(cle, 3, 60_000)).toBe(false);
  });

  it("repart à zéro une fois la fenêtre écoulée", () => {
    const cle = `test-${Math.random()}`;
    expect(checkRateLimit(cle, 1, 1)).toBe(true);
    expect(checkRateLimit(cle, 1, 1)).toBe(false);
    vi.setSystemTime(Date.now() + 10);
    expect(checkRateLimit(cle, 1, 1)).toBe(true);
    vi.useRealTimers();
  });

  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("oublie les compteurs expirés au lieu de les garder pour toujours", () => {
    const expire = `expire-${Math.random()}`;
    const vivant = `vivant-${Math.random()}`;
    checkRateLimit(expire, 1, 1_000);
    checkRateLimit(vivant, 1, 3_600_000);

    vi.setSystemTime(Date.now() + 5_000);
    const oublies = purgerCompteursExpires();

    // Sans ce balayage, chaque nom d'élève entré une fois occupe une entrée
    // pour la durée de vie du serveur.
    expect(oublies).toContain(expire);
    expect(oublies).not.toContain(vivant);
  });
});
