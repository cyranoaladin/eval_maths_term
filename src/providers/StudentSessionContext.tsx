/**
 * src/providers/StudentSessionContext.tsx
 *
 * Contexte React qui stocke le sessionToken élève en mémoire (pas de localStorage)
 * et expose un client tRPC spécialisé qui injecte automatiquement le header
 * `x-student-session-token` requis par `studentQuery` middleware.
 *
 * Usage :
 *   const { sessionToken, setSessionToken, studentTrpc } = useStudentSession();
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createTRPCReact, httpBatchLink } from "@trpc/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";

const studentTrpcClient = createTRPCReact<AppRouter>();

interface StudentSessionContextValue {
  sessionToken: string;
  sessionId: number | null;
  setSession: (token: string, id: number) => void;
  clearSession: () => void;
  studentTrpc: typeof studentTrpcClient;
}

const StudentSessionContext = createContext<StudentSessionContextValue | null>(null);

export function StudentSessionProvider({ children }: { children: ReactNode }) {
  const [sessionToken, setSessionToken] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const tokenRef = useRef(sessionToken);
  tokenRef.current = sessionToken;

  const setSession = useCallback((token: string, id: number) => {
    setSessionToken(token);
    setSessionId(id);
    tokenRef.current = token;
  }, []);

  const clearSession = useCallback(() => {
    setSessionToken("");
    setSessionId(null);
    tokenRef.current = "";
  }, []);

  // Créer un client tRPC séparé qui injecte le header à chaque requête
  const trpcInstance = useMemo(() => {
    const qc = new QueryClient();
    const client = studentTrpcClient.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          headers() {
            const tok = tokenRef.current;
            return tok
              ? { "x-student-session-token": tok }
              : {};
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
    return { client, qc };
  }, []); // stable: tokenRef is a ref, always up-to-date without recreating client

  const value: StudentSessionContextValue = useMemo(
    () => ({ sessionToken, sessionId, setSession, clearSession, studentTrpc: studentTrpcClient }),
    [sessionToken, sessionId, setSession, clearSession],
  );

  return (
    <StudentSessionContext.Provider value={value}>
      <studentTrpcClient.Provider client={trpcInstance.client} queryClient={trpcInstance.qc}>
        <QueryClientProvider client={trpcInstance.qc}>
          {children}
        </QueryClientProvider>
      </studentTrpcClient.Provider>
    </StudentSessionContext.Provider>
  );
}

export function useStudentSession(): StudentSessionContextValue {
  const ctx = useContext(StudentSessionContext);
  if (!ctx) {
    throw new Error("useStudentSession must be used inside <StudentSessionProvider>");
  }
  return ctx;
}

/** Alias du client tRPC student pour les imports dans Evaluation.tsx */
export { studentTrpcClient as strpc };
