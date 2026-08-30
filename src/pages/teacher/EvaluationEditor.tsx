/**
 * src/pages/teacher/EvaluationEditor.tsx
 *
 * Rédaction d'une évaluation : liste ordonnée des questions, ajout, édition,
 * réordonnancement, suppression. Chaque question est rendue en LaTeX comme
 * l'élève la verra.
 */
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, ChevronDown, ChevronUp, Pencil, Plus, Printer, Sparkles, Trash2, AlertTriangle,
} from "lucide-react";
import { MathLatex } from "@/components/math/MathLatex";
import { QuestionForm, type QuestionFormValue } from "@/components/authoring/QuestionForm";
import { GenerationPanel } from "@/components/authoring/GenerationPanel";
import { PrintPanel } from "@/components/paper/PrintPanel";
import { trpc } from "@/providers/trpc-client";
import type { GradingRubric } from "@contracts/grading-rubric";
import type { QuestionType } from "@contracts/types";

const TYPE_LABELS: Record<QuestionType, string> = {
  qcm: "QCM",
  true_false: "Vrai / Faux",
  short_answer: "Réponse courte",
};

export default function EvaluationEditor() {
  const params = useParams();
  const evaluationId = parseInt(params.id ?? "0", 10);
  const utils = trpc.useUtils();

  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [erreur, setErreur] = useState("");
  const [generating, setGenerating] = useState(false);
  const [printing, setPrinting] = useState(false);
  /** Proposition du modèle ouverte dans l'éditeur avant enregistrement. */
  const [prefill, setPrefill] = useState<QuestionFormValue | null>(null);

  const { data, isLoading } = trpc.authoring.getEvaluation.useQuery(
    { id: evaluationId },
    { enabled: evaluationId > 0 },
  );

  const invalider = () => utils.authoring.getEvaluation.invalidate({ id: evaluationId });
  const onErreur = (e: { message: string }) => setErreur(e.message);
  const onSucces = () => { setErreur(""); setEditing(null); setPrefill(null); invalider(); };

  const creerQuestion = trpc.authoring.createQuestion.useMutation({ onSuccess: onSucces, onError: onErreur });
  const modifierQuestion = trpc.authoring.updateQuestion.useMutation({ onSuccess: onSucces, onError: onErreur });
  const supprimerQuestion = trpc.authoring.deleteQuestion.useMutation({
    onSuccess: () => { setErreur(""); invalider(); }, onError: onErreur,
  });
  const reordonner = trpc.authoring.reorderQuestions.useMutation({
    onSuccess: () => { setErreur(""); invalider(); }, onError: onErreur,
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Chargement…</div>;
  if (!data) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm">Évaluation introuvable.</p>
        <Button asChild variant="outline"><Link to="/teacher/evaluations">Retour</Link></Button>
      </div>
    );
  }

  const { evaluation, questions, maxScore } = data;
  const enCours = creerQuestion.isPending || modifierQuestion.isPending;

  const deplacer = (index: number, delta: number) => {
    const cible = index + delta;
    if (cible < 0 || cible >= questions.length) return;
    const ids = questions.map((q) => q.id);
    [ids[index], ids[cible]] = [ids[cible], ids[index]];
    reordonner.mutate({ evaluationId, orderedIds: ids });
  };

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link to="/teacher/evaluations">
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Mes évaluations
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight truncate">{evaluation.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {questions.length} question{questions.length > 1 ? "s" : ""} · {maxScore} point
            {maxScore > 1 ? "s" : ""} · {evaluation.duration} min
            {!evaluation.isActive && " · brouillon"}
          </p>
        </div>
        {editing === null && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              onClick={() => { setErreur(""); setPrinting((p) => !p); }}
            >
              <Printer className="h-4 w-4 mr-1.5" /> Imprimer
            </Button>
            <Button
              variant="outline"
              onClick={() => { setErreur(""); setGenerating((g) => !g); }}
            >
              <Sparkles className="h-4 w-4 mr-1.5" /> Proposer des questions
            </Button>
            <Button onClick={() => { setErreur(""); setPrefill(null); setEditing("new"); }}>
              <Plus className="h-4 w-4 mr-1.5" /> Ajouter une question
            </Button>
          </div>
        )}
      </div>

      {erreur && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{erreur}</span>
        </div>
      )}

      {printing && editing === null && (
        <PrintPanel evaluationId={evaluationId} onClose={() => setPrinting(false)} />
      )}

      {generating && editing === null && (
        <GenerationPanel
          evaluationId={evaluationId}
          accepting={creerQuestion.isPending}
          onClose={() => setGenerating(false)}
          onAccept={(value) => {
            setErreur("");
            creerQuestion.mutate({ evaluationId, question: toInput(value) });
          }}
          onEdit={(value) => {
            setErreur("");
            setPrefill(value);
            setEditing("new");
          }}
        />
      )}

      {editing === "new" && (
        <QuestionForm
          submitting={enCours}
          initial={prefill ?? undefined}
          onCancel={() => { setEditing(null); setPrefill(null); }}
          onSubmit={(value) =>
            creerQuestion.mutate({ evaluationId, question: toInput(value) })
          }
        />
      )}

      {questions.map((q, index) => {
        const rubric = q.gradingRubric as GradingRubric | null;
        const options = q.options ?? [];
        const correctIndex = rubric?.mode.kind === "qcm" ? rubric.mode.correctIndex : -1;

        if (editing === q.id) {
          return (
            <QuestionForm
              key={q.id}
              submitting={enCours}
              initial={{
                type: q.type,
                question: q.question,
                options: q.options,
                correctAnswer: q.correctAnswer,
                justificationRequired: q.justificationRequired ?? false,
                points: q.points,
                difficulty: q.difficulty ?? undefined,
                tags: q.tags ?? undefined,
                gradingRubric: rubric!,
              }}
              onCancel={() => setEditing(null)}
              onSubmit={(value) =>
                modifierQuestion.mutate({ id: q.id, question: toInput(value) })
              }
            />
          );
        }

        return (
          <Card key={q.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-muted-foreground">
                    {index + 1}.
                  </span>
                  <Badge variant="outline">{TYPE_LABELS[q.type]}</Badge>
                  <Badge variant="secondary">
                    {q.points} pt{q.points > 1 ? "s" : ""}
                  </Badge>
                  {!rubric && (
                    <Badge variant="destructive" title="Sans barème, cette question ne peut pas être corrigée">
                      Barème manquant
                    </Badge>
                  )}
                  {(q.tags ?? []).map((t) => (
                    <Badge key={t} variant="outline" className="font-normal text-xs">{t}</Badge>
                  ))}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    size="icon" variant="ghost" aria-label="Monter"
                    onClick={() => deplacer(index, -1)}
                    disabled={index === 0 || reordonner.isPending}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon" variant="ghost" aria-label="Descendre"
                    onClick={() => deplacer(index, 1)}
                    disabled={index === questions.length - 1 || reordonner.isPending}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon" variant="ghost" aria-label="Modifier"
                    onClick={() => { setErreur(""); setEditing(q.id); }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon" variant="ghost" aria-label="Supprimer"
                    onClick={() => { setErreur(""); supprimerQuestion.mutate({ id: q.id }); }}
                    disabled={supprimerQuestion.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <CardTitle className="text-base font-normal leading-relaxed pt-1">
                <MathLatex tex={q.question} auto />
              </CardTitle>
            </CardHeader>

            {q.type === "qcm" && options.length > 0 && (
              <CardContent className="pt-0">
                <ul className="grid sm:grid-cols-2 gap-1.5">
                  {options.map((o, i) => (
                    <li
                      key={i}
                      className={`text-sm rounded border px-2.5 py-1.5 ${
                        i === correctIndex ? "border-green-400 bg-green-50" : ""
                      }`}
                    >
                      <span className="font-semibold mr-1.5">{String.fromCharCode(65 + i)}.</span>
                      <MathLatex tex={o} auto />
                      {i !== correctIndex && rubric?.distractorDiagnostics?.[i] && (
                        <p className="text-xs text-muted-foreground mt-1 pl-5 italic">
                          {rubric.distractorDiagnostics[i]}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}

            {q.type === "true_false" && (
              <CardContent className="pt-0 text-sm">
                Réponse attendue :{" "}
                <span className="font-medium text-green-700">
                  {q.correctAnswer === "true" ? "Vrai" : "Faux"}
                </span>
                {q.justificationRequired && (
                  <span className="text-muted-foreground"> · justification exigée</span>
                )}
              </CardContent>
            )}

            {q.type === "short_answer" && (
              <CardContent className="pt-0 text-sm">
                <span className="text-muted-foreground">Attendu : </span>
                <MathLatex tex={q.correctAnswer} auto />
                {rubric && (
                  <span className="text-muted-foreground"> · comparaison {rubric.mode.kind}</span>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}

      {questions.length === 0 && editing === null && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Cette évaluation n'a pas encore de question.
            </p>
            <Button variant="outline" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4 mr-1.5" /> Ajouter la première
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Adapte la valeur du formulaire au contrat attendu par le routeur. */
function toInput(v: QuestionFormValue) {
  return {
    type: v.type,
    question: v.question,
    options: v.options,
    correctAnswer: v.correctAnswer,
    justificationRequired: v.justificationRequired,
    points: v.points,
    gradingRubric: v.gradingRubric,
    tags: v.tags,
    difficulty: v.difficulty,
  };
}
