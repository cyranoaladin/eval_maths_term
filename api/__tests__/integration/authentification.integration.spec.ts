/**
 * L'authentification enseignant, telle qu'elle se présente au serveur.
 *
 * Un cookie absent, un jeton invalide, un compte supprimé : chacun de ces cas
 * doit fermer la porte, et aucun ne doit la laisser entrouverte. C'est le seul
 * rempart devant les copies et les notes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { authenticateRequest, createOAuthInitHandler } from "../../kimi/auth";
import { signSessionToken } from "../../kimi/session";
import { creerEnseignant, db, nettoyer } from "./harnais";
import { users } from "@db/schema";
import type { User } from "@db/schema";

let prof: User;

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant authentifié");
});

afterAll(async () => {
  await nettoyer([], [prof.id]);
});

function entetes(cookie: string): Headers {
  return new Headers(cookie ? { cookie } : {});
}

describe("authenticateRequest", () => {
  it("reconnaît un enseignant à son cookie", async () => {
    const jeton = await signSessionToken({ unionId: prof.unionId, clientId: "test" });
    const u = await authenticateRequest(entetes(`kimi_sid=${jeton}`));
    expect(u.id).toBe(prof.id);
    expect(u.role).toBe("teacher");
  });

  it("refuse une requête sans cookie", async () => {
    await expect(authenticateRequest(entetes(""))).rejects.toThrow();
  });

  it("refuse un cookie qui ne porte pas de session", async () => {
    await expect(authenticateRequest(entetes("autre=valeur"))).rejects.toThrow();
  });

  it("refuse un jeton illisible", async () => {
    await expect(authenticateRequest(entetes("kimi_sid=pas-un-jeton"))).rejects.toThrow();
  });

  it("refuse un jeton valide dont le compte n'existe plus", async () => {
    // Un enseignant supprimé garde un cookie signé valable douze heures : il
    // ne doit plus ouvrir de session pour autant.
    const fantome = await creerEnseignant("Compte supprimé");
    const jeton = await signSessionToken({ unionId: fantome.unionId, clientId: "test" });
    await db.delete(users).where(eq(users.id, fantome.id));
    await expect(authenticateRequest(entetes(`kimi_sid=${jeton}`))).rejects.toThrow();
  });
});

describe("démarrage du flux OAuth", () => {
  it("pose un état anti-rejeu et redirige vers le fournisseur", async () => {
    const app = new Hono();
    app.get("/api/oauth/login", createOAuthInitHandler());
    const rep = await app.request("http://localhost:3000/api/oauth/login");

    expect(rep.status).toBe(302);
    const destination = new URL(rep.headers.get("location")!);
    expect(destination.searchParams.get("response_type")).toBe("code");
    expect(destination.searchParams.get("client_id")).toBeTruthy();
    expect(destination.searchParams.get("redirect_uri")).toContain("/api/oauth/callback");

    // L'état est à la fois dans l'URL et dans un cookie HttpOnly : c'est leur
    // comparaison au retour qui empêche un tiers de forger la redirection.
    const etat = destination.searchParams.get("state");
    expect(etat).toHaveLength(32);
    const cookiePose = rep.headers.get("set-cookie") ?? "";
    expect(cookiePose).toContain(etat!);
    expect(cookiePose).toMatch(/HttpOnly/i);
    expect(cookiePose).toMatch(/SameSite=Lax/i);
  });
});
