import type { Context } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import * as jose from "jose";
import * as cookie from "cookie";
import { nanoid } from "nanoid";
import { env } from "../lib/env";
import { getSessionCookieOptions } from "../lib/cookies";
import { baseUrlPublique } from "../lib/base-url";
import { logger } from "../lib/logger";
import { Session, OAuthState, Paths } from "@contracts/constants";
import { Errors } from "@contracts/errors";
import { signSessionToken, verifySessionToken } from "./session";
import { users as kimiUsers } from "./platform";
import { enregistrerConnexion, findUserByUnionId } from "../queries/users";
import type { TokenResponse } from "./types";

async function exchangeAuthCode(
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: env.appId,
    redirect_uri: redirectUri,
    client_secret: env.appSecret,
  });

  const resp = await fetch(`${env.kimiAuthUrl}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }

  return resp.json() as Promise<TokenResponse>;
}

const jwks = jose.createRemoteJWKSet(
  new URL(`${env.kimiAuthUrl}/api/.well-known/jwks.json`),
);

/**
 * Ce que les revendications d'un jeton d'accès doivent dire.
 *
 * La signature ne suffit pas : le fournisseur signe aussi les jetons des autres
 * applications qu'il héberge. Un jeton valide émis pour une application tierce
 * était accepté ici tel quel, et son `user_id` devenait une identité chez nous.
 * Le `client_id` doit donc être le nôtre, et l'émetteur — quand le fournisseur
 * le renseigne — le serveur que nous interrogeons.
 *
 * Extrait de la vérification cryptographique pour être éprouvable sans réseau.
 */
export function validerRevendicationsJeton(payload: jose.JWTPayload): {
  userId: string;
  clientId: string;
} {
  const userId = payload.user_id as string;
  const clientId = payload.client_id as string;

  if (!userId) {
    throw new Error("user_id absent du jeton d'accès");
  }
  if (clientId !== env.appId) {
    throw new Error(
      "Le jeton d'accès a été émis pour une autre application : client_id inattendu.",
    );
  }
  if (typeof payload.iss === "string" && payload.iss !== "") {
    const attendu = new URL(env.kimiAuthUrl).origin;
    let emetteur: string;
    try {
      emetteur = new URL(payload.iss).origin;
    } catch {
      throw new Error("Le jeton d'accès porte un émetteur illisible.");
    }
    if (emetteur !== attendu) {
      throw new Error("Le jeton d'accès vient d'un autre émetteur.");
    }
  }
  return { userId, clientId };
}

async function verifyAccessToken(
  accessToken: string,
): Promise<{ userId: string; clientId: string }> {
  const { payload } = await jose.jwtVerify(accessToken, jwks);
  return validerRevendicationsJeton(payload);
}

export async function authenticateRequest(headers: Headers) {
  const cookies = cookie.parse(headers.get("cookie") || "");
  const token = cookies[Session.cookieName];
  if (!token) {
    throw Errors.forbidden("Invalid authentication token.");
  }
  const claim = await verifySessionToken(token);
  if (!claim) {
    throw Errors.forbidden("Invalid authentication token.");
  }
  const user = await findUserByUnionId(claim.unionId);
  if (!user) {
    throw Errors.forbidden("User not found. Please re-login.");
  }
  return user;
}

/**
 * Génère un state OAuth sécurisé (nanoid 32 chars) et le stocke
 * en cookie HttpOnly SameSite=Lax pour vérification CSRF au callback.
 * À appeler depuis le handler de démarrage OAuth côté client.
 */
export function createOAuthInitHandler() {
  return async (c: Context) => {
    const state = nanoid(32);

    // Le cookie d'état porte la protection CSRF du flux : il suit les mêmes
    // règles que le cookie de session, `Secure` compris.
    setCookie(c, OAuthState.cookieName, state, {
      ...getSessionCookieOptions(c.req.raw.headers),
      maxAge: OAuthState.maxAgeMs / 1000,
    });

    const redirectUri = `${baseUrlPublique(c.req.raw)}${Paths.oauthCallback}`;
    const authUrl = new URL(`${env.kimiAuthUrl}/api/oauth/authorize`);
    authUrl.searchParams.set("client_id", env.appId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);

    return c.redirect(authUrl.toString(), 302);
  };
}

export function createOAuthCallbackHandler() {
  return async (c: Context) => {
    const code = c.req.query("code");
    const stateFromQuery = c.req.query("state");
    const error = c.req.query("error");
    const errorDescription = c.req.query("error_description");

    if (error) {
      if (error === "access_denied") {
        return c.redirect(Paths.login, 302);
      }
      logger.warn("[OAuth] Erreur du provider OAuth", { error, errorDescription });
      return c.json({ error, error_description: errorDescription }, 400);
    }

    if (!code || !stateFromQuery) {
      return c.json({ error: "Les paramètres code et state sont requis" }, 400);
    }

    // III.6 : Vérification CSRF du state OAuth
    const storedState = getCookie(c, OAuthState.cookieName);
    if (!storedState || storedState !== stateFromQuery) {
      logger.warn("[OAuth] Échec CSRF : state OAuth invalide ou absent", {
        hasStoredState: !!storedState,
        statesMatch: storedState === stateFromQuery,
      });
      return c.json({ error: "Paramètre state invalide (protection CSRF)" }, 403);
    }

    // Suppression immédiate du cookie state après vérification
    deleteCookie(c, OAuthState.cookieName, { path: "/" });

    try {
      // La même adresse qu'au départ, et elle ne vient pas de la requête :
      // le fournisseur compare les deux, et un `Host` forgé les ferait diverger
      // — ou pire, les ferait coïncider sur un domaine choisi par un tiers.
      const redirectUri = `${baseUrlPublique(c.req.raw)}${Paths.oauthCallback}`;

      const tokenResp = await exchangeAuthCode(code, redirectUri);
      const { userId } = await verifyAccessToken(tokenResp.access_token);
      const userProfile = await kimiUsers.getProfile(tokenResp.access_token);

      if (!userProfile) {
        throw new Error("Impossible de récupérer le profil utilisateur Kimi Open");
      }

      // Le rôle et l'autorisation d'accès ne sont pas déduits d'ici : un
      // compte inconnu est créé sans droits, et un administrateur devra
      // l'autoriser.
      await enregistrerConnexion({
        unionId: userId,
        name: userProfile.name,
        avatar: userProfile.avatar_url,
      });

      const token = await signSessionToken({
        unionId: userId,
        clientId: env.appId,
      });

      const cookieOpts = getSessionCookieOptions(c.req.raw.headers);
      setCookie(c, Session.cookieName, token, {
        ...cookieOpts,
        maxAge: Session.maxAgeMs / 1000,
      });

      return c.redirect("/", 302);
    } catch (err) {
      logger.errorWithStack("[OAuth] Échec du callback", err);
      return c.json({ error: "Échec de l'authentification OAuth" }, 500);
    }
  };
}

export { exchangeAuthCode, verifyAccessToken };
