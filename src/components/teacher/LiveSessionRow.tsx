/**
 * src/components/teacher/LiveSessionRow.tsx
 *
 * Ligne du tableau Live Dashboard pour une session élève.
 */
import { UserCircle, Activity, AlertTriangle } from "lucide-react";
import { SuspicionBadge } from "./SuspicionBadge";
import { Button } from "@/components/ui/button";

export interface LiveSessionRowProps {
  sessionId: number;
  studentName: string;
  studentEmail: string | null;
  status: string;
  idleSec: number | null;
  suspicionScore: number;
  suspicionVerdict: string;
  totalDrafts: number;
  cheatEventCount: number;
  onForceSubmit?: (sessionId: number) => void;
}

const STATUS_LABEL: Record<string, string> = {
  in_progress:        "En cours",
  completed:          "Terminé",
  timed_out:          "Expiré",
  cheating_detected:  "Triche",
  auto_submitted_idle:"Auto-soumis",
};

export function LiveSessionRow({
  sessionId,
  studentName,
  studentEmail,
  status,
  idleSec,
  suspicionScore,
  suspicionVerdict,
  totalDrafts,
  cheatEventCount,
  onForceSubmit,
}: LiveSessionRowProps) {
  const isActive = status === "in_progress";
  const isIdle = isActive && idleSec !== null && idleSec >= 60;

  return (
    <tr className={`border-b text-sm ${isIdle ? "bg-yellow-50" : ""}`}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <UserCircle
            className={`h-5 w-5 shrink-0 ${isActive ? "text-blue-500" : "text-gray-300"}`}
            aria-hidden="true"
          />
          <div>
            <p className="font-medium">{studentName}</p>
            {studentEmail && (
              <p className="text-xs text-gray-500">{studentEmail}</p>
            )}
          </div>
        </div>
      </td>

      <td className="px-3 py-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            isActive
              ? "bg-green-100 text-green-800"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          {STATUS_LABEL[status] ?? status}
        </span>
      </td>

      <td className="px-3 py-2">
        {idleSec !== null ? (
          <span
            className={`flex items-center gap-1 text-xs ${idleSec >= 60 ? "text-yellow-600 font-semibold" : "text-gray-500"}`}
          >
            <Activity className="h-3 w-3" aria-hidden="true" />
            {idleSec}s
          </span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>

      <td className="px-3 py-2">
        <SuspicionBadge verdict={suspicionVerdict} score={suspicionScore} />
      </td>

      <td className="px-3 py-2 text-center text-xs text-gray-600">
        {totalDrafts}
      </td>

      <td className="px-3 py-2">
        {cheatEventCount > 0 ? (
          <span className="flex items-center gap-1 text-xs text-red-600">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            {cheatEventCount}
          </span>
        ) : (
          <span className="text-xs text-gray-400">0</span>
        )}
      </td>

      <td className="px-3 py-2">
        {isActive && onForceSubmit && (
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-xs"
            onClick={() => onForceSubmit(sessionId)}
          >
            Forcer soumission
          </Button>
        )}
      </td>
    </tr>
  );
}
