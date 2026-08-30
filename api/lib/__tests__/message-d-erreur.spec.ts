/**
 * Le message d'une erreur.
 *
 * Ce que le serveur renvoie à un client tient souvent à ce ternaire : une
 * erreur attendue porte son message, et ce qui n'est pas une erreur ne doit
 * pas se transformer en « [object Object] » dans l'interface d'un enseignant.
 */
import { describe, it, expect } from "vitest";
import { messageDErreur } from "@contracts/erreurs";

describe("message d'erreur", () => {
  it("rend le message d'une vraie erreur", () => {
    expect(messageDErreur(new Error("connexion coupée"))).toBe("connexion coupée");
    // Le repli ne prend pas la place d'un message réel.
    expect(messageDErreur(new Error("connexion coupée"), "Réessayez")).toBe("connexion coupée");
  });

  it("rend le repli demandé pour ce qui n'est pas une erreur", () => {
    expect(messageDErreur("un texte jeté", "Modification refusée")).toBe("Modification refusée");
    expect(messageDErreur({ code: 42 }, "Token invalide")).toBe("Token invalide");
  });

  it("décrit la valeur quand aucun repli n'est donné", () => {
    expect(messageDErreur("un texte jeté")).toBe("un texte jeté");
    expect(messageDErreur(null)).toBe("null");
  });
});
