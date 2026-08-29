/**
 * src/providers/student-session.ts
 *
 * Contexte et hook de session élève.
 * Séparés du fichier composant pour que `StudentSessionContext.tsx`
 * n'exporte que des composants (contrainte Fast Refresh).
 */
import { createContext, useContext } from "react";

export interface StudentSessionContextValue {
  /** Jeton JWT signé par le serveur à l'appel de `session.start`. */
  sessionToken: string;
  sessionId: number | null;
  setSession: (token: string, id: number) => void;
  clearSession: () => void;
}

export const StudentSessionContext =
  createContext<StudentSessionContextValue | null>(null);

export function useStudentSession(): StudentSessionContextValue {
  const ctx = useContext(StudentSessionContext);
  if (!ctx) {
    throw new Error(
      "useStudentSession doit être utilisé à l'intérieur de <StudentSessionProvider>",
    );
  }
  return ctx;
}
