/**
 * src/providers/StudentSessionContext.tsx
 *
 * Fournit la session élève : le jeton vit en mémoire et dans le `sessionStorage`
 * de l'onglet — jamais `localStorage`, il ne doit pas survivre à la fermeture de
 * l'onglet — et le client tRPC élève l'injecte automatiquement dans le header
 * `x-student-session-token`.
 *
 * Ce fichier n'exporte qu'un composant — le contexte et le hook vivent dans
 * `student-session.ts`, le client dans `student-trpc.ts`.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { httpBatchLink } from "@trpc/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import {
  StudentSessionContext,
  type StudentSessionContextValue,
} from "./student-session";
import { getStudentToken, restaurerSession, setStudentToken, studentTrpc } from "./student-trpc";

/**
 * Client créé une seule fois au chargement du module : le lien lit le jeton
 * via `getStudentToken()` à chaque requête, donc il n'a jamais besoin d'être
 * recréé quand le jeton change.
 */
const queryClient = new QueryClient();
const trpcClient = studentTrpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      headers() {
        const token = getStudentToken();
        return token ? { "x-student-session-token": token } : {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

export function StudentSessionProvider({ children }: { children: ReactNode }) {
  // Reprise après rechargement : l'état initial vient du stockage de l'onglet,
  // sans effet ni rendu supplémentaire.
  const reprise = restaurerSession();
  const [sessionToken, setSessionToken] = useState(reprise?.token ?? "");
  const [sessionId, setSessionId] = useState<number | null>(reprise?.sessionId ?? null);

  /**
   * Le cache est vidé à chaque changement de session : les requêtes élève
   * (`question.getForActiveSession`, `answer.listDrafts`) n'ont pas d'entrée,
   * donc leur clé de cache est identique d'une session à l'autre. Sans ce
   * vidage, une seconde évaluation ouverte dans le même onglet réafficherait
   * les questions — et l'ordre de mélange — de la première.
   */
  const setSession = useCallback((token: string, id: number) => {
    queryClient.clear();
    setStudentToken(token, id);
    setSessionToken(token);
    setSessionId(id);
  }, []);

  const clearSession = useCallback(() => {
    queryClient.clear();
    setStudentToken("");
    setSessionToken("");
    setSessionId(null);
  }, []);

  const value: StudentSessionContextValue = useMemo(
    () => ({ sessionToken, sessionId, setSession, clearSession }),
    [sessionToken, sessionId, setSession, clearSession],
  );

  return (
    <StudentSessionContext.Provider value={value}>
      <studentTrpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </studentTrpc.Provider>
    </StudentSessionContext.Provider>
  );
}
