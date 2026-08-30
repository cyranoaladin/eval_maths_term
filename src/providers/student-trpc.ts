/**
 * src/providers/student-trpc.ts
 *
 * Client tRPC dédié aux routes `studentQuery` (middleware requireStudentSessionToken).
 * Toute requête émise par ce client porte le header `x-student-session-token`.
 *
 * Le jeton vit dans un porte-jeton hors React : le client tRPC est créé une seule
 * fois pour la durée de la page et son lien HTTP lit le jeton à chaque requête.
 * Un `useRef` ne conviendrait pas — il serait lu pendant le rendu par le lien.
 */
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../api/router";

export const studentTrpc = createTRPCReact<AppRouter>();

/**
 * Le jeton est aussi conservé dans `sessionStorage`.
 *
 * En mémoire seule, un simple rechargement de page — touche F5, plantage de
 * l'onglet, coupure d'affichage — faisait perdre la composition en cours :
 * l'élève devait recommencer une nouvelle session, ses brouillons devenant
 * inaccessibles. `sessionStorage` a exactement la bonne durée de vie : il
 * survit au rechargement et disparaît à la fermeture de l'onglet, ce qui reste
 * conforme à la règle « pas de persistance entre deux passations ».
 *
 * Le jeton est signé et daté par le serveur : le conserver n'accorde aucun
 * droit supplémentaire et ne survit pas à son expiration.
 */
const CLE_JETON = "session-eleve";
const CLE_SESSION_ID = "session-eleve-id";

const tokenHolder = { current: "" };

function lireStockage(cle: string): string {
  try {
    return sessionStorage.getItem(cle) ?? "";
  } catch {
    // Navigation privée ou stockage refusé : on continue en mémoire seule.
    return "";
  }
}

function ecrireStockage(cle: string, valeur: string): void {
  try {
    if (valeur) sessionStorage.setItem(cle, valeur);
    else sessionStorage.removeItem(cle);
  } catch {
    // Sans stockage, le rechargement fera perdre la session — pas la copie.
  }
}

/** Enregistre le jeton de session élève émis par `session.start`. */
export function setStudentToken(token: string, sessionId?: number): void {
  tokenHolder.current = token;
  ecrireStockage(CLE_JETON, token);
  if (sessionId !== undefined) ecrireStockage(CLE_SESSION_ID, String(sessionId));
  if (!token) ecrireStockage(CLE_SESSION_ID, "");
}

/** Lit le jeton courant. Chaîne vide tant qu'aucune session n'a démarré. */
export function getStudentToken(): string {
  if (!tokenHolder.current) tokenHolder.current = lireStockage(CLE_JETON);
  return tokenHolder.current;
}

/** Session reprise après un rechargement, s'il y en a une. */
export function restaurerSession(): { token: string; sessionId: number } | null {
  const token = lireStockage(CLE_JETON);
  const id = Number.parseInt(lireStockage(CLE_SESSION_ID), 10);
  if (!token || Number.isNaN(id)) return null;
  tokenHolder.current = token;
  return { token, sessionId: id };
}
