/**
 * Le flux OAuth complet, du départ au cookie de session.
 *
 * Les gardes prises une à une sont éprouvées ailleurs ; ici c'est
 * l'enchaînement qui est en cause — l'aller, le retour, l'échange du code, la
 * vérification du jeton, la lecture du profil, la création du compte. C'est le
 * seul chemin par lequel un enseignant entre dans l'application, et il ne
 * l'était que par des lectures.
 *
 * Le fournisseur est ici un serveur de théâtre : de vraies clés, de vrais
 * jetons signés, de vraies réponses HTTP. Rien n'est simulé du côté de notre
 * code.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Hono } from "hono";
import * as jose from "jose";
import { eq } from "drizzle-orm";
import { db } from "./harnais";
import { users } from "@db/schema";
import { env } from "../../lib/env";
import { Session, OAuthState, Paths } from "@contracts/constants";
import {
  createOAuthInitHandler,
  createOAuthCallbackHandler,
  authenticateRequest,
} from "../../kimi/auth";
import { signSessionToken } from "../../kimi/session";

const FETCH_INITIAL = globalThis.fetch;
let clePrivee: jose.CryptoKey;
let jwks: jose.JSONWebKeySet;
const unionIds: string[] = [];

/** Ce que le fournisseur répondra au prochain appel. Chaque test le règle. */
let scenario: {
  token?: { statut: number; corps: unknown };
  profil?: { statut: number; corps: unknown };
};

function nouvelUnionId(): string {
  const id = `oauth-${process.pid}-${unionIds.length + 1}`;
  unionIds.push(id);
  return id;
}

/** Un jeton d'accès tel que le fournisseur en émet : signé par sa clé. */
async function jetonDAcces(
  revendications: Record<string, unknown> = {},
): Promise<string> {
  return new jose.SignJWT({
    client_id: env.appId,
    user_id: nouvelUnionId(),
    ...revendications,
  })
    .setProtectedHeader({ alg: "RS256", kid: "cle-de-test" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(clePrivee);
}

const application = new Hono();
application.get("/api/oauth/start", createOAuthInitHandler());
application.get(Paths.oauthCallback, createOAuthCallbackHandler());

/** Le retour du fournisseur, avec l'état qu'il est censé nous rendre. */
function retour(params: Record<string, string>, cookieEtat?: string) {
  const url = new URL(`http://atelier.test${Paths.oauthCallback}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return application.request(url.toString(), {
    headers: cookieEtat ? { cookie: `${OAuthState.cookieName}=${cookieEtat}` } : {},
  });
}

beforeAll(async () => {
  const paire = await jose.generateKeyPair("RS256", { extractable: true });
  clePrivee = paire.privateKey;
  const publique = await jose.exportJWK(paire.publicKey);
  jwks = { keys: [{ ...publique, kid: "cle-de-test", alg: "RS256", use: "sig" }] };

  // Le fournisseur de théâtre. Tout ce qui ne le concerne pas continue son
  // chemin : on n'aveugle pas le reste de la suite.
  globalThis.fetch = (async (entree: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;

    if (url.endsWith("/api/.well-known/jwks.json")) {
      return Response.json(jwks);
    }
    if (url.endsWith("/api/oauth/token")) {
      const t = scenario.token ?? { statut: 200, corps: { access_token: await jetonDAcces() } };
      return new Response(JSON.stringify(t.corps), {
        status: t.statut,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/v1/users/me/profile")) {
      const p = scenario.profil ?? {
        statut: 200,
        corps: { name: "Enseignante Aïcha", avatar_url: "https://exemple.test/a.png" },
      };
      return new Response(JSON.stringify(p.corps), {
        status: p.statut,
        headers: { "content-type": "application/json" },
      });
    }
    return FETCH_INITIAL(entree, init);
  }) as typeof fetch;
});

afterEach(() => {
  scenario = {};
});

afterAll(async () => {
  globalThis.fetch = FETCH_INITIAL;
  for (const id of unionIds) await db.delete(users).where(eq(users.unionId, id));
});

describe("départ", () => {
  it("pose un état imprévisible et envoie l'enseignant chez le fournisseur", async () => {
    const reponse = await application.request("http://atelier.test/api/oauth/start");

    expect(reponse.status).toBe(302);
    const destination = new URL(reponse.headers.get("location")!);
    expect(destination.origin + destination.pathname).toBe(
      `${env.kimiAuthUrl}/api/oauth/authorize`,
    );
    expect(destination.searchParams.get("client_id")).toBe(env.appId);
    expect(destination.searchParams.get("response_type")).toBe("code");

    const etat = destination.searchParams.get("state")!;
    expect(etat).toHaveLength(32);

    // Le même état repart en cookie : c'est la comparaison des deux qui
    // protège le retour.
    const pose = reponse.headers.get("set-cookie")!;
    expect(pose).toContain(`${OAuthState.cookieName}=${etat}`);
    expect(pose).toContain("HttpOnly");
    expect(pose).toContain("SameSite=Lax");

    // L'adresse de retour ne vient pas de la requête.
    const retourAnnonce = destination.searchParams.get("redirect_uri")!;
    expect(retourAnnonce.endsWith(Paths.oauthCallback)).toBe(true);
  });

  it("tire un état différent à chaque départ", async () => {
    const a = await application.request("http://atelier.test/api/oauth/start");
    const b = await application.request("http://atelier.test/api/oauth/start");
    const etat = (r: Response) =>
      new URL(r.headers.get("location")!).searchParams.get("state");
    expect(etat(a)).not.toBe(etat(b));
  });
});

describe("retour du fournisseur", () => {
  it("ouvre la session et crée le compte, sans lui donner d'accès", async () => {
    const reponse = await retour({ code: "code-valide", state: "etat-abc" }, "etat-abc");

    expect(reponse.status).toBe(302);
    expect(reponse.headers.get("location")).toBe("/");

    const cookies = reponse.headers.get("set-cookie")!;
    expect(cookies).toContain(`${Session.cookieName}=`);
    // L'état a servi une fois : il est effacé au retour.
    expect(cookies).toContain(`${OAuthState.cookieName}=;`);

    const unionId = unionIds[unionIds.length - 1];
    const [compte] = await db.select().from(users).where(eq(users.unionId, unionId));
    expect(compte.name).toBe("Enseignante Aïcha");
    // Un inconnu n'est pas enseignant : il attend qu'on l'autorise.
    expect(compte.role).toBe("student");
    expect(compte.status).toBe("pending");
  });

  it("ramène à la page de connexion quand l'enseignant a refusé", async () => {
    const reponse = await retour({ error: "access_denied" });
    expect(reponse.status).toBe(302);
    expect(reponse.headers.get("location")).toBe(Paths.login);
  });

  it("rapporte une erreur du fournisseur sans ouvrir de session", async () => {
    const reponse = await retour({
      error: "server_error",
      error_description: "indisponible",
    });
    expect(reponse.status).toBe(400);
    await expect(reponse.json()).resolves.toMatchObject({ error: "server_error" });
    expect(reponse.headers.get("set-cookie")).toBeNull();
  });

  it("refuse un retour incomplet", async () => {
    expect((await retour({ code: "seul" })).status).toBe(400);
    expect((await retour({ state: "seul" })).status).toBe(400);
  });

  it("refuse un état qui ne correspond pas à celui qu'on a posé", async () => {
    const reponse = await retour({ code: "c", state: "etat-du-pirate" }, "etat-a-nous");
    expect(reponse.status).toBe(403);
    await expect(reponse.json()).resolves.toMatchObject({ error: expect.stringMatching(/CSRF/) });
  });

  it("refuse un retour sans état posé : le flux n'est pas parti d'ici", async () => {
    const reponse = await retour({ code: "c", state: "etat-inconnu" });
    expect(reponse.status).toBe(403);
  });

  it("ne crée pas de compte si l'échange du code échoue", async () => {
    scenario.token = { statut: 400, corps: { error: "invalid_grant" } };
    const avant = (await db.select().from(users)).length;

    const reponse = await retour({ code: "perime", state: "e" }, "e");

    expect(reponse.status).toBe(500);
    expect(reponse.headers.get("set-cookie")).not.toContain(Session.cookieName);
    expect((await db.select().from(users)).length).toBe(avant);
  });

  it("ne crée pas de compte si le jeton vient d'une autre application", async () => {
    scenario.token = {
      statut: 200,
      corps: { access_token: await jetonDAcces({ client_id: "une-autre-application" }) },
    };
    const reponse = await retour({ code: "c", state: "e" }, "e");
    expect(reponse.status).toBe(500);
  });

  it("ne crée pas de compte si le profil est refusé par la plateforme", async () => {
    scenario.profil = { statut: 401, corps: { error: "unauthorized" } };
    const avant = (await db.select().from(users)).length;

    const reponse = await retour({ code: "c", state: "e" }, "e");

    expect(reponse.status).toBe(500);
    expect((await db.select().from(users)).length).toBe(avant);
  });
});

describe("reconnaissance d'une requête déjà authentifiée", () => {
  it("rend l'utilisateur porté par un cookie valide", async () => {
    await retour({ code: "c", state: "e" }, "e");
    const unionId = unionIds[unionIds.length - 1];
    const jeton = await signSessionToken({ unionId, clientId: env.appId });

    const utilisateur = await authenticateRequest(
      new Headers({ cookie: `${Session.cookieName}=${jeton}` }),
    );

    expect(utilisateur.unionId).toBe(unionId);
  });

  it("refuse une requête sans cookie", async () => {
    await expect(authenticateRequest(new Headers())).rejects.toMatchObject({
      message: expect.stringContaining("Invalid authentication token"),
    });
  });

  it("refuse un jeton illisible", async () => {
    await expect(
      authenticateRequest(new Headers({ cookie: `${Session.cookieName}=pas-un-jeton` })),
    ).rejects.toMatchObject({ message: expect.stringContaining("Invalid authentication token") });
  });

  it("refuse un jeton valide dont le compte a disparu", async () => {
    const jeton = await signSessionToken({ unionId: "compte-efface", clientId: env.appId });
    await expect(
      authenticateRequest(new Headers({ cookie: `${Session.cookieName}=${jeton}` })),
    ).rejects.toMatchObject({ message: expect.stringContaining("User not found") });
  });
});
