/**
 * src/pages/teacher/Correction.tsx
 *
 * Correction copie par copie.
 *
 * Le serveur savait déjà tout faire — `session.getDetailsForTeacher`,
 * `grading2.overrideGrade`, `grading2.gradeSession`, `grading2.auditTrail` —
 * mais aucun écran ne s'y raccordait. Cette page ne crée aucune procédure.
 *
 * Deux principes tenus à l'écran :
 * - une note posée à la main est signalée comme protégée, et une recorrection
 *   ne l'efface pas ;
 * - toute modification exige un motif, qui rejoint le journal d'audit.
 */
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle, ArrowLeft, Check, History, Lock, RefreshCw, Users, X,
} from "lucide-react";
import { MathLatex } from "@/components/math/MathLatex";
import { SuspicionBadge } from "@/components/teacher/SuspicionBadge";
import { trpc } from "@/providers/trpc-client";
import type { GradingRubric } from "@contracts/grading-rubric";

const LETTRES = ["A", "B", "C", "D", "E", "F"];

const MODES_LISIBLES: Record<string, string> = {
  qcm: "QCM",
  true_false: "Vrai/Faux",
  exact: "texte exact",
  fraction: "fraction",
  acceptable_form: "forme acceptée",
  llm: "relecture LLM",
  manual_override: "corrigée à la main",
  manual_paper: "notée sur copie",
  missing_rubric: "barème manquant",
  invalid_rubric: "barème invalide",
};

function estManuel(mode: string | null | undefined): boolean {
  return mode === "manual_override" || mode === "manual_paper";
}

export default function Correction() {
  const params = useParams();
  const paperExamId = parseInt(params.examId ?? "0", 10);
  const [recherche, setRecherche] = useSearchParams();
  const utils = trpc.useUtils();

  const studentParam = recherche.get("eleve");
  const [erreur, setErreur] = useState("");
  const [journalOuvert, setJournalOuvert] = useState(false);
  const [edition, setEdition] = useState<number | null>(null);
  const [points, setPoints] = useState("");
  const [motif, setMotif] = useState("");

  const { data: grille } = trpc.paper.entrySheet.useQuery(
    { paperExamId },
    { enabled: paperExamId > 0, retry: false },
  );

  const copies = grille?.copies ?? [];
  const copieCourante =
    (studentParam
      ? copies.find((c) => String(c.studentId) === studentParam)
      : copies.find((c) => c.entered)) ?? null;

  // La copie n'a de session qu'une fois saisie.
  const sessionId = copieCourante?.sessionId ?? 0;

  const { data: resultats } = trpc.paper.results.useQuery(
    { paperExamId },
    { enabled: paperExamId > 0, retry: false },
  );

  const { data: detail, isLoading } = trpc.session.getDetailsForTeacher.useQuery(
    { sessionId: sessionId || 0 },
    { enabled: sessionId > 0, retry: false },
  );

  const { data: journal } = trpc.grading2.auditTrail.useQuery(
    { sessionId: sessionId || 0 },
    { enabled: journalOuvert && sessionId > 0, retry: false },
  );

  const rafraichir = () => {
    utils.session.getDetailsForTeacher.invalidate({ sessionId });
    utils.grading2.auditTrail.invalidate({ sessionId });
    utils.paper.entrySheet.invalidate({ paperExamId });
    utils.paper.results.invalidate({ paperExamId });
  };

  const corriger = trpc.grading2.overrideGrade.useMutation({
    onSuccess: () => { setErreur(""); setEdition(null); setMotif(""); rafraichir(); },
    onError: (e) => setErreur(e.message),
  });

  const recorriger = trpc.grading2.gradeSession.useMutation({
    onSuccess: () => { setErreur(""); rafraichir(); },
    onError: (e) => setErreur(e.message),
  });

  const reponses = useMemo(() => {
    const liste = detail?.responses ?? [];
    return [...liste].sort((a, b) => (a.question?.order ?? 0) - (b.question?.order ?? 0));
  }, [detail]);

  if (!grille) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm">Ce tirage n'est pas encore généré.</p>
        <Button asChild variant="outline">
          <Link to="/teacher/evaluations">Retour aux évaluations</Link>
        </Button>
      </div>
    );
  }

  const notesParEleve = new Map<string, number | null>(
    (resultats?.lignes ?? []).map((l) => [l.nom, l.note20]),
  );

  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
          <Link to={`/teacher/saisie/${paperExamId}`}>
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Saisie des copies
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Correction</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {grille.exam.evaluationTitle} · {grille.exam.className}
          {grille.exam.label ? ` · ${grille.exam.label}` : ""}
        </p>
      </div>

      {erreur && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{erreur}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        {/* ── Copies ── */}
        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Users className="h-4 w-4" /> Copies
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 space-y-0.5 max-h-[70vh] overflow-y-auto">
            {copies.map((c) => (
              <button
                key={c.studentId}
                onClick={() => {
                  setRecherche({ eleve: String(c.studentId) });
                  setEdition(null);
                  setErreur("");
                }}
                disabled={!c.entered}
                className={`w-full text-left px-2.5 py-1.5 rounded-md text-sm flex items-center gap-2 transition-colors disabled:opacity-40 ${
                  copieCourante?.studentId === c.studentId
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                }`}
              >
                <span className="truncate flex-1">{c.name}</span>
                <span className="text-xs shrink-0">
                  {c.entered ? notesParEleve.get(c.name) ?? c.normalizedScore ?? "—" : "non saisie"}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* ── Copie ── */}
        <div className="space-y-3">
          {!copieCourante?.entered ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Sélectionnez une copie saisie pour la corriger.
              </CardContent>
            </Card>
          ) : isLoading ? (
            <Card><CardContent className="py-10 text-center text-sm">Chargement…</CardContent></Card>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base">{copieCourante.name}</CardTitle>
                        {/*
                          Le score de suspicion n'était visible que sur le
                          tableau de surveillance, pendant la composition — donc
                          plus du tout au moment où l'enseignant note la copie.
                          C'est pourtant là qu'il en a besoin.
                        */}
                        {detail?.session.suspicionVerdict && (
                          <SuspicionBadge
                            verdict={detail.session.suspicionVerdict}
                            score={detail.session.suspicionScore ?? 0}
                          />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {detail?.session.totalScore ?? 0}/{detail?.session.maxScore ?? 0} points
                        {detail?.session.normalizedScore != null && (
                          <span className="ml-2 font-medium text-foreground">
                            {detail.session.normalizedScore}/20
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setJournalOuvert((v) => !v)}
                      >
                        <History className="h-4 w-4 mr-1.5" />
                        {journalOuvert ? "Masquer le journal" : "Journal"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={recorriger.isPending}
                        onClick={() => {
                          setErreur("");
                          recorriger.mutate({
                            sessionId,
                            reason: "Relance depuis l'écran de correction",
                          });
                        }}
                      >
                        <RefreshCw className="h-4 w-4 mr-1.5" />
                        {recorriger.isPending ? "Correction…" : "Recorriger"}
                      </Button>
                    </div>
                  </div>
                  {(detail?.cheatEvents.length ?? 0) > 0 && (
                    <p className="text-xs text-amber-700">
                      {detail!.cheatEvents.length} incident
                      {detail!.cheatEvents.length > 1 ? "s" : ""} de surveillance :{" "}
                      {[...new Set(detail!.cheatEvents.map((e) => e.type))].join(", ")}.
                      Un score élevé ne vaut pas preuve — c'est à vous de trancher.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Une recorrection réapplique le barème automatique.
                    <span className="font-medium"> Les notes posées à la main sont conservées.</span>
                  </p>
                </CardHeader>
              </Card>

              {journalOuvert && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Journal des interventions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1.5 text-xs">
                    {(journal ?? []).length === 0 && (
                      <p className="text-muted-foreground">Aucune intervention sur cette copie.</p>
                    )}
                    {(journal ?? []).map((l) => (
                      <div key={l.id} className="flex flex-wrap items-baseline gap-x-2 border-b pb-1.5 last:border-0">
                        <Badge variant="outline" className="text-xs">
                          {l.action === "manual_override" ? "correction"
                            : l.action === "manual_paper" ? "note sur copie" : "recorrection"}
                        </Badge>
                        <span className="text-muted-foreground">
                          {new Date(l.date).toLocaleString("fr-FR")}
                        </span>
                        <span>{l.auteur}</span>
                        {l.ancienneNote !== null || l.nouvelleNote !== null ? (
                          <span className="font-medium">
                            {l.ancienneNote ?? "—"} → {l.nouvelleNote ?? "—"}
                          </span>
                        ) : null}
                        {l.motif && <span className="italic text-muted-foreground">« {l.motif} »</span>}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {reponses.map((r, index) => {
                const q = r.question;
                const rubric = (q?.gradingRubric ?? null) as GradingRubric | null;
                const correctIndex =
                  rubric?.mode.kind === "qcm" ? rubric.mode.correctIndex : -1;
                const options = r.options ?? [];
                const manuel = estManuel(r.gradingMode);
                const choix =
                  q?.type === "qcm" ? Number.parseInt(r.answer, 10)
                  : q?.type === "true_false" ? (r.answer === "true" ? 0 : 1)
                  : -1;

                return (
                  <Card key={r.id} className={manuel ? "border-amber-300" : undefined}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-muted-foreground">
                            {index + 1}.
                          </span>
                          <Badge variant="outline">
                            {q?.type === "qcm" ? "QCM"
                              : q?.type === "true_false" ? "Vrai/Faux" : "Réponse courte"}
                          </Badge>
                          <Badge variant={r.score === q?.points ? "default" : "secondary"}>
                            {r.score ?? 0}/{q?.points ?? 0}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {MODES_LISIBLES[r.gradingMode ?? ""] ?? r.gradingMode ?? "non corrigée"}
                          </span>
                          {manuel && (
                            <Badge variant="outline" className="text-amber-700 border-amber-300">
                              <Lock className="h-3 w-3 mr-1" /> protégée
                            </Badge>
                          )}
                        </div>
                        {edition !== r.id && (
                          <Button size="sm" variant="ghost" onClick={() => {
                            setEdition(r.id);
                            setPoints(String(r.score ?? 0));
                            setMotif("");
                            setErreur("");
                          }}>
                            Modifier les points
                          </Button>
                        )}
                      </div>
                      <CardTitle className="text-sm font-normal leading-relaxed pt-1">
                        <MathLatex tex={q?.question ?? ""} auto />
                      </CardTitle>
                    </CardHeader>

                    <CardContent className="space-y-2 text-sm">
                      {q?.type === "qcm" && options.length > 0 && (
                        <ul className="grid sm:grid-cols-2 gap-1.5">
                          {options.map((o, i) => (
                            <li key={i} className={`rounded border px-2.5 py-1.5 ${
                              i === correctIndex ? "border-green-400 bg-green-50"
                              : i === choix ? "border-red-300 bg-red-50" : ""
                            }`}>
                              <span className="font-semibold mr-1.5">{LETTRES[i]}.</span>
                              <MathLatex tex={o} auto />
                              {i === choix && (
                                <span className="ml-1.5 text-xs text-muted-foreground">
                                  (réponse de l'élève)
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}

                      {q?.type !== "qcm" && (
                        <div className="space-y-1">
                          <p>
                            <span className="text-muted-foreground">Réponse : </span>
                            <MathLatex tex={r.answer} auto />
                          </p>
                          <p>
                            <span className="text-muted-foreground">Attendu : </span>
                            <MathLatex tex={q?.correctAnswer ?? ""} auto />
                          </p>
                          {r.justification && (
                            <p className="text-xs">
                              <span className="text-muted-foreground">Justification : </span>
                              {r.justification}
                            </p>
                          )}
                        </div>
                      )}

                      {r.llmFeedback && (
                        <p className="text-xs italic text-muted-foreground border-l-2 pl-2">
                          {r.llmFeedback}
                        </p>
                      )}

                      {rubric?.detailedRubric && (
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Attendus : </span>
                          <MathLatex tex={rubric.detailedRubric} auto />
                        </p>
                      )}

                      {edition === r.id && (
                        <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="space-y-1">
                              <Label htmlFor={`pts-${r.id}`} className="text-xs">Points</Label>
                              <Input
                                id={`pts-${r.id}`}
                                type="number" min={0} max={q?.points ?? 20} step={0.25}
                                value={points}
                                onChange={(e) => setPoints(e.target.value)}
                                className="h-8 w-24"
                              />
                            </div>
                            <span className="text-xs text-muted-foreground pb-2">
                              / {q?.points ?? 0}
                            </span>
                            <div className="space-y-1 flex-1 min-w-[220px]">
                              <Label htmlFor={`motif-${r.id}`} className="text-xs">
                                Motif (obligatoire)
                              </Label>
                              <Input
                                id={`motif-${r.id}`}
                                value={motif}
                                onChange={(e) => setMotif(e.target.value)}
                                placeholder="Démarche juste, erreur de recopie"
                                className="h-8"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={motif.trim().length < 3 || corriger.isPending}
                              onClick={() => corriger.mutate({
                                responseId: r.id,
                                score: Number(points.replace(",", ".")) || 0,
                                reason: motif.trim(),
                              })}
                            >
                              <Check className="h-4 w-4 mr-1" /> Enregistrer
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEdition(null)}>
                              <X className="h-4 w-4 mr-1" /> Annuler
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
