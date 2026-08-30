/**
 * src/components/authoring/GenerationPanel.tsx
 *
 * Génération assistée de QCM.
 *
 * Le modèle **propose**, l'enseignant dispose : rien n'est écrit en base tant
 * qu'une proposition n'a pas été explicitement ajoutée. Une proposition jugée
 * incohérente est affichée avec ses motifs et ne peut être ajoutée qu'après
 * passage par l'éditeur.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, Pencil, Sparkles, X } from "lucide-react";
import { MathLatex } from "@/components/math/MathLatex";
import { trpc } from "@/providers/trpc-client";
import type { QuestionFormValue } from "./QuestionForm";
import type { GradingRubric } from "@contracts/grading-rubric";

interface Proposal {
  draft: {
    type: "qcm";
    question: string;
    options: string[];
    correctAnswer: string;
    points: number;
    difficulty: number;
    tags: string[];
    gradingRubric: GradingRubric;
  };
  valid: boolean;
  errors: string[];
}

interface Props {
  evaluationId: number;
  /** Ajout direct en base d'une proposition jugée bonne telle quelle. */
  onAccept: (value: QuestionFormValue) => void;
  /** Ouverture de l'éditeur pré-rempli, pour retoucher avant d'enregistrer. */
  onEdit: (value: QuestionFormValue) => void;
  onClose: () => void;
  accepting?: boolean;
}

export function GenerationPanel({ evaluationId, onAccept, onEdit, onClose, accepting }: Props) {
  const [theme, setTheme] = useState("");
  const [count, setCount] = useState(3);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(2);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [erreur, setErreur] = useState("");

  const { data: llm } = trpc.authoring.llmStatus.useQuery();

  const generer = trpc.authoring.generateQuestions.useMutation({
    onSuccess: (r) => {
      setProposals(r.proposals as Proposal[]);
      setRejected(r.rejected);
      setSources(r.sources ?? []);
      setErreur("");
    },
    onError: (e) => setErreur(e.message),
  });

  const toValue = (p: Proposal): QuestionFormValue => ({
    type: "qcm",
    question: p.draft.question,
    options: p.draft.options,
    correctAnswer: p.draft.correctAnswer,
    points: p.draft.points,
    difficulty: p.draft.difficulty,
    tags: p.draft.tags,
    gradingRubric: p.draft.gradingRubric,
  });

  const retirer = (index: number) =>
    setProposals((prev) => prev.filter((_, i) => i !== index));

  if (llm && !llm.configured) {
    return (
      <Card className="border-amber-300 bg-amber-50/50">
        <CardContent className="py-6 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <p className="font-medium text-amber-900">Génération indisponible</p>
            <p className="text-amber-800">
              Aucune clé n'est configurée. Renseignez <code>LLM_API_KEY</code> dans
              le fichier <code>.env</code> pour activer l'assistance.
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-violet-200">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-600" />
              Proposer des questions
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Chaque mauvaise réponse proposée doit correspondre à une erreur type
              et porter son diagnostic. Vous relisez avant tout enregistrement.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="theme">Thème ou capacité visée</Label>
            <Input
              id="theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="convergence des suites géométriques"
              onKeyDown={(e) => {
                if (e.key === "Enter" && theme.trim().length >= 3) {
                  generer.mutate({ evaluationId, theme: theme.trim(), count, difficulty });
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="count">Nombre</Label>
            <Input
              id="count"
              type="number"
              min={1}
              max={10}
              value={count}
              onChange={(e) => setCount(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)))}
              className="w-20"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Difficulté</Label>
            <div className="flex gap-1">
              {([1, 2, 3] as const).map((d) => (
                <Button
                  key={d}
                  type="button"
                  size="sm"
                  variant={difficulty === d ? "default" : "outline"}
                  onClick={() => setDifficulty(d)}
                >
                  {d === 1 ? "Facile" : d === 2 ? "Moyen" : "Difficile"}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => generer.mutate({ evaluationId, theme: theme.trim(), count, difficulty })}
            disabled={theme.trim().length < 3 || generer.isPending}
          >
            <Sparkles className="h-4 w-4 mr-1.5" />
            {generer.isPending ? "Rédaction en cours…" : "Rédiger les questions"}
          </Button>
          {generer.isPending && (
            <p className="text-xs text-muted-foreground">
              Comptez une à deux minutes : le modèle raisonne avant de rédiger.
            </p>
          )}
          {llm?.model && !generer.isPending && (
            <span className="text-xs text-muted-foreground">
              Modèle : {llm.model}
              {llm.ragAvailable ? " · ancré sur vos documents" : " · sans ancrage documentaire"}
            </span>
          )}
        </div>

        {erreur && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {erreur}
          </div>
        )}

        {sources.length > 0 && (
          <div className="rounded-lg border bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <span className="font-medium">Extraits de cours utilisés : </span>
            {sources.join(" · ")}
          </div>
        )}

        {rejected.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="font-medium">Propositions écartées avant relecture :</p>
            <ul className="list-disc pl-4 mt-1">
              {rejected.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        )}

        {proposals.map((p, index) => {
          const correctIndex =
            p.draft.gradingRubric.mode.kind === "qcm"
              ? p.draft.gradingRubric.mode.correctIndex
              : -1;
          const diagnostics = p.draft.gradingRubric.distractorDiagnostics ?? [];

          return (
            <div
              key={index}
              className={`rounded-lg border p-4 space-y-3 ${p.valid ? "" : "border-amber-400 bg-amber-50/40"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">QCM</Badge>
                  <Badge variant="secondary">
                    {p.draft.points} pt{p.draft.points > 1 ? "s" : ""}
                  </Badge>
                  {p.draft.tags.map((t) => (
                    <Badge key={t} variant="outline" className="font-normal text-xs">{t}</Badge>
                  ))}
                  {!p.valid && <Badge variant="destructive">À corriger</Badge>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => { onAccept(toValue(p)); retirer(index); }}
                    disabled={!p.valid || accepting}
                    title={p.valid ? "Ajouter telle quelle" : "Corrigez-la d'abord dans l'éditeur"}
                  >
                    <Check className="h-4 w-4 mr-1" /> Ajouter à l'évaluation
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { onEdit(toValue(p)); retirer(index); }}
                  >
                    <Pencil className="h-4 w-4 mr-1" /> Retoucher
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Écarter"
                    onClick={() => retirer(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {!p.valid && (
                <ul className="text-xs text-amber-800 list-disc pl-4">
                  {p.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}

              <p className="text-sm leading-relaxed">
                <MathLatex tex={p.draft.question} auto />
              </p>

              <ul className="space-y-1.5">
                {p.draft.options.map((o, i) => (
                  <li
                    key={i}
                    className={`text-sm rounded border px-2.5 py-1.5 ${
                      i === correctIndex ? "border-green-400 bg-green-50" : "bg-white"
                    }`}
                  >
                    <span className="font-semibold mr-1.5">{String.fromCharCode(65 + i)}.</span>
                    <MathLatex tex={o} auto />
                    {i !== correctIndex && diagnostics[i] && (
                      <p className="text-xs text-muted-foreground mt-1 pl-5 italic">
                        <MathLatex tex={diagnostics[i]} auto />
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              {p.draft.gradingRubric.detailedRubric && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Attendus : </span>
                  <MathLatex tex={p.draft.gradingRubric.detailedRubric} auto />
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default GenerationPanel;
