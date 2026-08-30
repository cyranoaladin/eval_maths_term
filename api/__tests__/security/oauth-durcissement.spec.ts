/**
 * Le flux OAuth ne fait plus confiance à la requête.
 *
 * Trois choses venaient du client et n'auraient jamais dû :
 *
 * - l'URL de redirection était fabriquée à partir de l'en-tête `Host`, que le
 *   client fournit — derrière un reverse proxy qui le transmet sans le valider,
 *   il suffit d'en changer pour diriger le code d'autorisation ailleurs ;
 * - l'attribut `Secure` du cookie de session se décidait sur ce même en-tête :
 *   un `Host: localhost:3000` forgé donnait un cookie transmissible en clair ;
 * - le jeton d'accès n'était vérifié que sur sa signature, alors que le
 *   fournisseur signe aussi les jetons des autres applications qu'il héberge.
 */
import { describe, it, expect, afterEach } from "vitest";
import { env, verifierUrlPubliqueDeProduction } from "../../lib/env";
import { baseUrlPublique } from "../../lib/base-url";
import { getSessionCookieOptions } from "../../lib/cookies";
import { validerRevendicationsJeton } from "../../kimi/auth";

type EnvMutable = { isProduction: boolean; publicBaseUrl: string };
const initial = { isProduction: env.isProduction, publicBaseUrl: env.publicBaseUrl };

afterEach(() => {
  (env as unknown as EnvMutable).isProduction = initial.isProduction;
  (env as unknown as EnvMutable).publicBaseUrl = initial.publicBaseUrl;
});

function enProduction(baseUrl: string) {
  (env as unknown as EnvMutable).isProduction = true;
  (env as unknown as EnvMutable).publicBaseUrl = baseUrl;
}

describe("PUBLIC_BASE_URL", () => {
  it("est exigée en production", () => {
    const fautes = verifierUrlPubliqueDeProduction({ NODE_ENV: "production" });
    expect(fautes).toHaveLength(1);
    expect(fautes[0]).toMatch(/PUBLIC_BASE_URL est requise/);
  });

  it("doit être en https", () => {
    const fautes = verifierUrlPubliqueDeProduction({
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "http://eval.exemple.fr",
    });
    expect(fautes.some((f) => /https/.test(f))).toBe(true);
  });

  it("refuse une valeur qui n'est pas une URL absolue", () => {
    const fautes = verifierUrlPubliqueDeProduction({
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "eval.exemple.fr",
    });
    expect(fautes).toHaveLength(1);
  });

  it("tolère http sur la boucle locale, pour éprouver l'image de production", () => {
    expect(
      verifierUrlPubliqueDeProduction({
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "http://127.0.0.1:3100",
      }),
    ).toEqual([]);
  });

  it("accepte une adresse correcte", () => {
    expect(
      verifierUrlPubliqueDeProduction({
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "https://eval.exemple.fr",
      }),
    ).toEqual([]);
  });

  it("ne gêne pas le développement", () => {
    expect(verifierUrlPubliqueDeProduction({ NODE_ENV: "development" })).toEqual([]);
  });
});

describe("adresse publique", () => {
  it("ignore l'en-tête Host en production", () => {
    enProduction("https://eval.etablissement.fr");
    const requete = new Request("https://eval.etablissement.fr/api/oauth/login", {
      headers: { host: "attaquant.example" },
    });
    expect(baseUrlPublique(requete)).toBe("https://eval.etablissement.fr");
  });

  it("ignore X-Forwarded-Host en production", () => {
    enProduction("https://eval.etablissement.fr");
    const requete = new Request("https://eval.etablissement.fr/api/oauth/login", {
      headers: { "x-forwarded-host": "attaquant.example" },
    });
    expect(baseUrlPublique(requete)).toBe("https://eval.etablissement.fr");
  });

  it("se déduit de la requête hors production, pour une machine sans configuration", () => {
    (env as unknown as EnvMutable).isProduction = false;
    (env as unknown as EnvMutable).publicBaseUrl = "";
    const requete = new Request("http://localhost:3000/api/oauth/login");
    expect(baseUrlPublique(requete)).toBe("http://localhost:3000");
  });
});

describe("cookie de session", () => {
  it("est Secure en production, quel que soit l'en-tête Host", () => {
    enProduction("https://eval.etablissement.fr");
    const entetes = new Headers({ host: "localhost:3000" });
    expect(getSessionCookieOptions(entetes).secure).toBe(true);
  });

  it("reste utilisable en clair sur une machine de développement", () => {
    (env as unknown as EnvMutable).isProduction = false;
    const entetes = new Headers({ host: "localhost:3000" });
    expect(getSessionCookieOptions(entetes).secure).toBe(false);
  });

  it("est HttpOnly et SameSite=Lax", () => {
    const options = getSessionCookieOptions(new Headers({ host: "localhost:3000" }));
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("Lax");
  });
});

describe("revendications du jeton d'accès", () => {
  it("accepte un jeton émis pour cette application", () => {
    const resultat = validerRevendicationsJeton({
      user_id: "u-1",
      client_id: env.appId,
    });
    expect(resultat.userId).toBe("u-1");
  });

  it("refuse un jeton émis pour une autre application", () => {
    expect(() =>
      validerRevendicationsJeton({ user_id: "u-1", client_id: "une-autre-appli" }),
    ).toThrow(/autre application/);
  });

  it("refuse un jeton sans client_id", () => {
    expect(() => validerRevendicationsJeton({ user_id: "u-1" })).toThrow();
  });

  it("refuse un jeton sans user_id", () => {
    expect(() => validerRevendicationsJeton({ client_id: env.appId })).toThrow(/user_id/);
  });

  it("refuse un émetteur différent du serveur interrogé", () => {
    expect(() =>
      validerRevendicationsJeton({
        user_id: "u-1",
        client_id: env.appId,
        iss: "https://auth.attaquant.example",
      }),
    ).toThrow(/autre émetteur/);
  });

  it("refuse un émetteur qui n'est même pas une adresse", () => {
    expect(() =>
      validerRevendicationsJeton({ user_id: "u1", client_id: env.appId, iss: "pas-une-url" }),
    ).toThrow(/émetteur illisible/);
  });

  it("accepte l'émetteur attendu", () => {
    const attendu = new URL(env.kimiAuthUrl).origin;
    expect(
      validerRevendicationsJeton({
        user_id: "u-1",
        client_id: env.appId,
        iss: attendu,
      }).userId,
    ).toBe("u-1");
  });
});
