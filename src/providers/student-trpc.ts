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

const tokenHolder = { current: "" };

/** Enregistre le jeton de session élève émis par `session.start`. */
export function setStudentToken(token: string): void {
  tokenHolder.current = token;
}

/** Lit le jeton courant. Chaîne vide tant qu'aucune session n'a démarré. */
export function getStudentToken(): string {
  return tokenHolder.current;
}
