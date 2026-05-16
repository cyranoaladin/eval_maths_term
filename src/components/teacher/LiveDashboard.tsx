/**
 * src/components/teacher/LiveDashboard.tsx
 *
 * Tableau de bord enseignant en temps réel.
 * Polling 5 s via trpc.teacherLive.snapshot.useQuery.
 * Pas de SSE, pas de WebSocket.
 */
import { useCallback } from "react";
import { RefreshCw, Users } from "lucide-react";
import { trpc } from "@/providers/trpc-client";
import { LiveSessionRow } from "./LiveSessionRow";
import { Button } from "@/components/ui/button";

const POLL_INTERVAL_MS = 5_000;

export interface LiveDashboardProps {
  evaluationId: number;
}

export function LiveDashboard({ evaluationId }: LiveDashboardProps) {
  const { data, isLoading, error, refetch } = trpc.teacherLive.snapshot.useQuery(
    { evaluationId },
    {
      refetchInterval: POLL_INTERVAL_MS,
      refetchIntervalInBackground: true,
    },
  );

  const forceSubmitMutation = trpc.teacherLive.forceSubmit.useMutation({
    onSuccess: () => { refetch(); },
  });

  const handleForceSubmit = useCallback(
    (sessionId: number) => {
      if (confirm("Forcer la soumission de cette session ?")) {
        forceSubmitMutation.mutate({ sessionId });
      }
    },
    [forceSubmitMutation],
  );

  const sessions = data?.sessions ?? [];
  const activeSessions = sessions.filter((s) => s.status === "in_progress");
  const serverTime = data?.serverTime;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-blue-600" aria-hidden="true" />
          <h2 className="text-lg font-semibold">
            Suivi en direct
          </h2>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            {activeSessions.length} actif{activeSessions.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {serverTime && (
            <span className="text-xs text-gray-400">
              Mis à jour : {new Date(serverTime).toLocaleTimeString("fr-FR")}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            aria-label="Actualiser le tableau"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Erreur de chargement : {error.message}
        </div>
      )}

      {sessions.length === 0 && !isLoading && (
        <div className="py-10 text-center text-sm text-gray-400">
          Aucune session pour cette évaluation.
        </div>
      )}

      {sessions.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="w-full text-left">
            <thead className="border-b bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-2">Élève</th>
                <th scope="col" className="px-3 py-2">Statut</th>
                <th scope="col" className="px-3 py-2">Idle</th>
                <th scope="col" className="px-3 py-2">Suspicion</th>
                <th scope="col" className="px-3 py-2 text-center">Brouillons</th>
                <th scope="col" className="px-3 py-2">Incidents</th>
                <th scope="col" className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <LiveSessionRow
                  key={s.sessionId}
                  {...s}
                  onForceSubmit={handleForceSubmit}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
