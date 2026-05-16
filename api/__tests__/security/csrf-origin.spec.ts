import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkOrigin } from "../../lib/csrf";

/**
 * III.8 — Tests de la vérification CSRF par Origin.
 */

describe("csrf-origin : vérification de l'en-tête Origin", () => {
  beforeEach(() => {
    // Réinitialise les modules pour repartir d'un état propre
    vi.resetModules();
  });

  it("accepte une origin autorisée", () => {
    const req = new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });
    // Ne doit pas lever d'erreur
    expect(() => checkOrigin(req)).not.toThrow();
  });

  it("rejette une origin non autorisée", () => {
    const req = new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
    });
    expect(() => checkOrigin(req)).toThrow(/non autorisée/i);
  });

  it("accepte les requêtes GET sans vérification d'origin", () => {
    // Les GET n'ont pas besoin d'origin — le middleware CSRF ne les bloque pas
    const req = new Request("http://localhost:3000/api/trpc/test", {
      method: "GET",
    });
    // checkOrigin s'applique aux mutations — en développement, sans origin c'est OK
    // Ce test vérifie seulement que la fonction ne lève pas d'erreur hors production
    expect(() => checkOrigin(req)).not.toThrow();
  });

  it("rejette une origin vide avec chaîne non autorisée", () => {
    const req = new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: { origin: "https://malicious.site.com" },
    });
    expect(() => checkOrigin(req)).toThrow();
  });

  it("le middleware CSRF retourne 403 pour une origin non autorisée", async () => {
    const { csrfMiddleware } = await import("../../lib/csrf");
    const req = new Request("http://localhost:3000/api/trpc/mutation", {
      method: "POST",
      headers: { origin: "https://attacker.com" },
    });
    const response = await csrfMiddleware(req, async () => new Response("ok"));
    expect(response.status).toBe(403);
  });

  it("le middleware CSRF passe au handler suivant pour une origin autorisée", async () => {
    const { csrfMiddleware } = await import("../../lib/csrf");
    const req = new Request("http://localhost:3000/api/trpc/mutation", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });
    const response = await csrfMiddleware(req, async () => new Response("ok", { status: 200 }));
    expect(response.status).toBe(200);
  });
});
