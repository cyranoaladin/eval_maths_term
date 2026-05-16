/**
 * src/components/teacher/SuspicionBadge.tsx
 *
 * Badge coloré indiquant le niveau de suspicion d'une session.
 */
import { Badge } from "@/components/ui/badge";

type SuspicionVerdict = "clean" | "minor" | "moderate" | "severe";

const VERDICT_CONFIG: Record<
  SuspicionVerdict,
  { label: string; className: string }
> = {
  clean:    { label: "Propre",    className: "bg-green-100 text-green-800 border-green-200" },
  minor:    { label: "Mineur",    className: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  moderate: { label: "Modéré",   className: "bg-orange-100 text-orange-800 border-orange-200" },
  severe:   { label: "Sévère",   className: "bg-red-100 text-red-800 border-red-200" },
};

export interface SuspicionBadgeProps {
  verdict: string;
  score?: number;
}

export function SuspicionBadge({ verdict, score }: SuspicionBadgeProps) {
  const config =
    VERDICT_CONFIG[verdict as SuspicionVerdict] ?? VERDICT_CONFIG.clean;

  return (
    <Badge
      variant="outline"
      className={`font-semibold ${config.className}`}
      title={score !== undefined ? `Score : ${score}/100` : undefined}
    >
      {config.label}
      {score !== undefined && (
        <span className="ml-1 opacity-60">({score})</span>
      )}
    </Badge>
  );
}
