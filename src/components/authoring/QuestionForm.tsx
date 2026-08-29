/**
 * src/components/authoring/QuestionForm.tsx
 *
 * Rédaction d'une question, avec aperçu LaTeX en direct.
 *
 * Principe : le barème de correction (`gradingRubric`) est la seule source de
 * vérité, et `correctAnswer` en est dérivé. L'enseignant ne peut donc pas créer
 * la divergence que `validateQuestionCoherence` sanctionne — celle-ci reste en
 * filet, appliquée ici comme sur le serveur, avec les mêmes règles.
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertTriangle, Plus, Trash2, Eye } from "lucide-react";
import { MathLatex } from "@/components/math/MathLatex";
import {
  validateQuestionCoherence,
  type QuestionDraft,
} from "@contracts/question-coherence";
import type { GradingRubric } from "@contracts/grading-rubric";
import type { QuestionType } from "@contracts/types";

export interface QuestionFormValue {
  type: QuestionType;
  question: string;
  options: string[] | null;
  correctAnswer: string;
  justificationRequired?: boolean;
  points: number;
  gradingRubric: GradingRubric;
  tags?: string[];
  difficulty?: number;
}

interface Props {
  initial?: QuestionFormValue;
  submitting?: boolean;
  onSubmit: (value: QuestionFormValue) => void;
  onCancel: () => void;
}

type ShortMode = "exact" | "numeric" | "fraction" | "symbolic" | "set";

const TYPE_LABELS: Record<QuestionType, string> = {
  qcm: "QCM",
  true_false: "Vrai / Faux",
  short_answer: "Réponse courte",
};

const SHORT_MODE_LABELS: Record<ShortMode, string> = {
  exact: "Texte exact",
  numeric: "Valeur numérique (avec tolérance)",
  fraction: "Fraction",
  symbolic: "Expression symbolique",
  set: "Ensemble de valeurs",
};

export function QuestionForm({ initial, submitting, onSubmit, onCancel }: Props) {
  const [type, setType] = useState<QuestionType>(initial?.type ?? "qcm");
  const [enonce, setEnonce] = useState(initial?.question ?? "");
  const [points, setPoints] = useState(initial?.points ?? 1);
  const [difficulty, setDifficulty] = useState(initial?.difficulty ?? 2);
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [detailedRubric, setDetailedRubric] = useState(
    initial?.gradingRubric.detailedRubric ?? "",
  );
  const [llmReview, setLlmReview] = useState(initial?.gradingRubric.llmReviewRequired ?? false);

  // ── QCM ──
  const [options, setOptions] = useState<string[]>(
    initial?.options?.length ? initial.options : ["", "", "", ""],
  );
  const [correctIndex, setCorrectIndex] = useState(
    initial?.gradingRubric.mode.kind === "qcm" ? initial.gradingRubric.mode.correctIndex : 0,
  );
  const [diagnostics, setDiagnostics] = useState<string[]>(
    initial?.gradingRubric.distractorDiagnostics ?? ["", "", "", ""],
  );

  // ── Vrai / Faux ──
  const [correctValue, setCorrectValue] = useState<"true" | "false">(
    initial?.gradingRubric.mode.kind === "true_false" ? initial.gradingRubric.mode.correctValue : "true",
  );
  const [justificationRequired, setJustificationRequired] = useState(
    initial?.justificationRequired ?? false,
  );

  // ── Réponse courte ──
  const initialShortMode: ShortMode =
    initial && ["exact", "numeric", "fraction", "symbolic", "set"].includes(initial.gradingRubric.mode.kind)
      ? (initial.gradingRubric.mode.kind as ShortMode)
      : "exact";
  const [shortMode, setShortMode] = useState<ShortMode>(initialShortMode);
  const [expected, setExpected] = useState(initial?.correctAnswer ?? "");
  const [numTolerance, setNumTolerance] = useState(
    initial?.gradingRubric.mode.kind === "numeric" ? String(initial.gradingRubric.mode.tolerance) : "0.01",
  );
  const [numRelative, setNumRelative] = useState(
    initial?.gradingRubric.mode.kind === "numeric" ? initial.gradingRubric.mode.relative : false,
  );
  const [fracNum, setFracNum] = useState(
    initial?.gradingRubric.mode.kind === "fraction" ? String(initial.gradingRubric.mode.numerator) : "1",
  );
  const [fracDen, setFracDen] = useState(
    initial?.gradingRubric.mode.kind === "fraction" ? String(initial.gradingRubric.mode.denominator) : "2",
  );
  const [fracReduced, setFracReduced] = useState(
    initial?.gradingRubric.mode.kind === "fraction" ? initial.gradingRubric.mode.reduced : true,
  );
  const [symVariables, setSymVariables] = useState(
    initial?.gradingRubric.mode.kind === "symbolic" ? initial.gradingRubric.mode.variables.join(", ") : "x",
  );
  const [setOrdered, setSetOrdered] = useState(
    initial?.gradingRubric.mode.kind === "set" ? initial.gradingRubric.mode.ordered : false,
  );

  /** Construit la valeur soumise — `correctAnswer` dérive toujours du barème. */
  const value = useMemo((): QuestionFormValue => {
    const commonRubric = {
      llmReviewRequired: llmReview,
      weight: points,
      detailedRubric: detailedRubric.trim() || undefined,
    };

    if (type === "qcm") {
      const nettoyees = diagnostics.slice(0, options.length).map((d) => d.trim());
      return {
        type,
        question: enonce,
        options,
        correctAnswer: String(correctIndex),
        points,
        difficulty,
        tags: parseTags(tags),
        gradingRubric: {
          ...commonRubric,
          mode: { kind: "qcm", correctIndex },
          distractorDiagnostics: nettoyees.some((d) => d.length > 0) ? nettoyees : undefined,
        },
      };
    }

    if (type === "true_false") {
      return {
        type,
        question: enonce,
        options: null,
        correctAnswer: correctValue,
        justificationRequired,
        points,
        difficulty,
        tags: parseTags(tags),
        gradingRubric: { ...commonRubric, mode: { kind: "true_false", correctValue } },
      };
    }

    return {
      type,
      question: enonce,
      options: null,
      correctAnswer: expected,
      points,
      difficulty,
      tags: parseTags(tags),
      gradingRubric: { ...commonRubric, mode: buildShortMode() },
    };

    function buildShortMode(): GradingRubric["mode"] {
      switch (shortMode) {
        case "numeric":
          return {
            kind: "numeric",
            value: Number(expected.replace(",", ".")) || 0,
            tolerance: Number(numTolerance.replace(",", ".")) || 0,
            relative: numRelative,
          };
        case "fraction":
          return {
            kind: "fraction",
            numerator: parseInt(fracNum, 10) || 0,
            denominator: Math.max(1, parseInt(fracDen, 10) || 1),
            reduced: fracReduced,
          };
        case "symbolic":
          return { kind: "symbolic", canonical: expected, variables: parseTags(symVariables) };
        case "set":
          return {
            kind: "set",
            values: expected.split(";").map((v) => v.trim()).filter(Boolean),
            ordered: setOrdered,
          };
        default:
          return { kind: "exact" };
      }
    }
  }, [
    type, enonce, points, difficulty, tags, detailedRubric, llmReview,
    options, correctIndex, diagnostics,
    correctValue, justificationRequired,
    shortMode, expected, numTolerance, numRelative, fracNum, fracDen, fracReduced,
    symVariables, setOrdered,
  ]);

  const verdict = useMemo(
    () => validateQuestionCoherence(value as QuestionDraft),
    [value],
  );

  const setOption = (i: number, v: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  const setDiagnostic = (i: number, v: string) =>
    setDiagnostics((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push("");
      next[i] = v;
      return next;
    });

  const addOption = () => {
    setOptions((prev) => [...prev, ""]);
    setDiagnostics((prev) => [...prev, ""]);
  };
  const removeOption = (i: number) => {
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
    setDiagnostics((prev) => prev.filter((_, idx) => idx !== i));
    if (correctIndex >= i && correctIndex > 0) setCorrectIndex((c) => c - 1);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* ── Formulaire ── */}
      <div className="lg:col-span-3 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Type et barème</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant={type === t ? "default" : "outline"}
                  size="sm"
                  onClick={() => setType(t)}
                >
                  {TYPE_LABELS[t]}
                </Button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="points">Points</Label>
                <Input
                  id="points"
                  type="number"
                  min={1}
                  max={20}
                  value={points}
                  onChange={(e) => setPoints(Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="difficulty">Difficulté</Label>
                <div className="flex gap-1">
                  {[1, 2, 3].map((d) => (
                    <Button
                      key={d}
                      type="button"
                      variant={difficulty === d ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => setDifficulty(d)}
                    >
                      {d === 1 ? "Facile" : d === 2 ? "Moyen" : "Difficile"}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tags">Notions (séparées par des virgules)</Label>
              <Input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="suites, convergence"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Énoncé</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={enonce}
              onChange={(e) => setEnonce(e.target.value)}
              placeholder={"Les mathématiques s'écrivent entre $…$ :\nSoit $f(x)=\\dfrac{1}{x}$. Alors…"}
              className="min-h-[110px] font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-2">
              LaTeX entre <code>$…$</code> en ligne, <code>$$…$$</code> centré. L'aperçu est à droite.
            </p>
          </CardContent>
        </Card>

        {type === "qcm" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Propositions</CardTitle>
              <p className="text-xs text-muted-foreground">
                Cochez la bonne réponse. Pour chaque distracteur, nommez l'erreur type :
                l'élève la lira à la place d'un « Réponse incorrecte » qui ne lui apprend rien.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <RadioGroup
                value={String(correctIndex)}
                onValueChange={(v) => setCorrectIndex(parseInt(v, 10))}
              >
                {options.map((opt, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border p-3 space-y-2 ${
                      correctIndex === i ? "border-green-400 bg-green-50/60" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value={String(i)} id={`opt-${i}`} />
                      <Label htmlFor={`opt-${i}`} className="text-xs font-semibold w-5">
                        {String.fromCharCode(65 + i)}
                      </Label>
                      <Input
                        value={opt}
                        onChange={(e) => setOption(i, e.target.value)}
                        placeholder={`Proposition ${String.fromCharCode(65 + i)}`}
                        className="font-mono text-sm"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeOption(i)}
                        disabled={options.length <= 2}
                        aria-label={`Supprimer la proposition ${String.fromCharCode(65 + i)}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {correctIndex !== i && (
                      <Input
                        value={diagnostics[i] ?? ""}
                        onChange={(e) => setDiagnostic(i, e.target.value)}
                        placeholder="Erreur type : « vous avez confondu… ». Renvoyez vers une méthode."
                        className="text-xs ml-7"
                      />
                    )}
                  </div>
                ))}
              </RadioGroup>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addOption}
                disabled={options.length >= 8}
              >
                <Plus className="h-4 w-4 mr-1" /> Ajouter une proposition
              </Button>
            </CardContent>
          </Card>
        )}

        {type === "true_false" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Réponse attendue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <RadioGroup
                value={correctValue}
                onValueChange={(v) => setCorrectValue(v as "true" | "false")}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="true" id="tf-true" />
                  <Label htmlFor="tf-true">Vrai</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="false" id="tf-false" />
                  <Label htmlFor="tf-false">Faux</Label>
                </div>
              </RadioGroup>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="justif"
                  checked={justificationRequired}
                  onCheckedChange={(c) => setJustificationRequired(c === true)}
                />
                <Label htmlFor="justif" className="text-sm font-normal">
                  Exiger une justification rédigée
                </Label>
              </div>
              {justificationRequired && (
                <p className="text-xs text-muted-foreground">
                  La justification est évaluée par le LLM : renseignez les attendus ci-dessous.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {type === "short_answer" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Réponse attendue et mode de comparaison</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(SHORT_MODE_LABELS) as ShortMode[]).map((m) => (
                  <Button
                    key={m}
                    type="button"
                    variant={shortMode === m ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShortMode(m)}
                  >
                    {SHORT_MODE_LABELS[m]}
                  </Button>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="expected">
                  {shortMode === "set" ? "Valeurs attendues (séparées par ;)" : "Réponse attendue"}
                </Label>
                <Input
                  id="expected"
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  placeholder={shortMode === "set" ? "-2 ; 3" : "1/2"}
                  className="font-mono text-sm"
                />
              </div>

              {shortMode === "numeric" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="tol">Tolérance</Label>
                    <Input id="tol" value={numTolerance} onChange={(e) => setNumTolerance(e.target.value)} />
                  </div>
                  <div className="flex items-end pb-2 gap-2">
                    <Checkbox
                      id="rel"
                      checked={numRelative}
                      onCheckedChange={(c) => setNumRelative(c === true)}
                    />
                    <Label htmlFor="rel" className="text-sm font-normal">Tolérance relative</Label>
                  </div>
                </div>
              )}

              {shortMode === "fraction" && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="num">Numérateur</Label>
                    <Input id="num" value={fracNum} onChange={(e) => setFracNum(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="den">Dénominateur</Label>
                    <Input id="den" value={fracDen} onChange={(e) => setFracDen(e.target.value)} />
                  </div>
                  <div className="flex items-end pb-2 gap-2">
                    <Checkbox
                      id="red"
                      checked={fracReduced}
                      onCheckedChange={(c) => setFracReduced(c === true)}
                    />
                    <Label htmlFor="red" className="text-sm font-normal">Exiger irréductible</Label>
                  </div>
                </div>
              )}

              {shortMode === "symbolic" && (
                <div className="space-y-1.5">
                  <Label htmlFor="vars">Variables (séparées par des virgules)</Label>
                  <Input id="vars" value={symVariables} onChange={(e) => setSymVariables(e.target.value)} />
                </div>
              )}

              {shortMode === "set" && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="ord"
                    checked={setOrdered}
                    onCheckedChange={(c) => setSetOrdered(c === true)}
                  />
                  <Label htmlFor="ord" className="text-sm font-normal">L'ordre compte</Label>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Attendus de correction</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={detailedRubric}
              onChange={(e) => setDetailedRubric(e.target.value)}
              placeholder="Ce que doit contenir une réponse juste, et les erreurs à sanctionner."
              className="min-h-[70px] text-sm"
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="llm"
                checked={llmReview}
                onCheckedChange={(c) => setLlmReview(c === true)}
              />
              <Label htmlFor="llm" className="text-sm font-normal">
                Faire relire la réponse par le LLM si la comparaison échoue
              </Label>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Aperçu et validation ── */}
      <div className="lg:col-span-2 space-y-4">
        <Card className="lg:sticky lg:top-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4" /> Aperçu élève
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{TYPE_LABELS[type]}</Badge>
              <Badge variant="secondary">{points} point{points > 1 ? "s" : ""}</Badge>
            </div>

            <div className="text-sm leading-relaxed min-h-[2rem]">
              {enonce ? (
                <MathLatex tex={enonce} auto />
              ) : (
                <span className="text-muted-foreground italic">L'énoncé apparaîtra ici.</span>
              )}
            </div>

            {type === "qcm" && (
              <ul className="space-y-1.5">
                {options.map((o, i) => (
                  <li
                    key={i}
                    className={`text-sm rounded border px-2.5 py-1.5 ${
                      correctIndex === i ? "border-green-400 bg-green-50" : "bg-white"
                    }`}
                  >
                    <span className="font-semibold mr-1.5">{String.fromCharCode(65 + i)}.</span>
                    {o ? <MathLatex tex={o} auto /> : <span className="text-muted-foreground italic">vide</span>}
                  </li>
                ))}
              </ul>
            )}

            {type === "true_false" && (
              <div className="flex gap-3 text-sm">
                <span className={correctValue === "true" ? "font-semibold text-green-700" : ""}>Vrai</span>
                <span className={correctValue === "false" ? "font-semibold text-green-700" : ""}>Faux</span>
              </div>
            )}

            {type === "short_answer" && expected && (
              <div className="text-sm">
                <span className="text-muted-foreground">Attendu : </span>
                <MathLatex tex={expected} auto />
              </div>
            )}

            {!verdict.ok && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-1">
                <p className="text-xs font-medium text-amber-800 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> À corriger avant enregistrement
                </p>
                <ul className="text-xs text-amber-800 list-disc pl-4 space-y-0.5">
                  {verdict.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                className="flex-1"
                disabled={!verdict.ok || submitting}
                onClick={() => onSubmit(value)}
              >
                {submitting ? "Enregistrement…" : "Enregistrer"}
              </Button>
              <Button type="button" variant="outline" onClick={onCancel}>
                Annuler
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export default QuestionForm;
