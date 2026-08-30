/**
 * src/pages/teacher/PaperEntry.tsx
 *
 * Saisie des copies papier.
 *
 * Reprend le principe de `QCM_EDS_MATHS_TERM/manual_entry.html`, qui fonctionne :
 * un élève à la fois, une grille de lettres, tout au clavier. Saisir trente
 * copies de trente questions demande neuf cents frappes — chaque aller-retour
 * vers la souris coûte cher.
 *
 * Frappe d'une lettre : la réponse est posée et le curseur avance seul.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Check, Download, Keyboard, PenLine, Save, Users } from "lucide-react";
import { MathLatex } from "@/components/math/MathLatex";
import { trpc } from "@/providers/trpc-client";

const LETTRES = ["A", "B", "C", "D", "E", "F"];

export default function PaperEntry() {
  const params = useParams();
  const paperExamId = parseInt(params.examId ?? "0", 10);
  const utils = trpc.useUtils();

  // `null` tant que l'enseignant n'a rien choisi : l'élève affiché est alors
  // déduit du tirage. Dériver plutôt que synchroniser évite un effet qui
  // écrirait dans l'état à chaque chargement.
  const [studentId, setStudentId] = useState<number | null>(null);
  /** `null` = la grille reflète ce qui est en base ; sinon, les retouches en cours. */
  const [edits, setEdits] = useState<Record<number, number | null> | null>(null);
  /** Points des questions rédigées, corrigées à la main sur la copie. */
  const [notesRedigees, setNotesRedigees] = useState<Record<number, string> | null>(null);
  const [curseur, setCurseur] = useState(0);
  const [erreur, setErreur] = useState("");
  const [dernierScore, setDernierScore] = useState<string | null>(null);
  const grilleRef = useRef<HTMLDivElement>(null);

  const { data: resultats } = trpc.paper.results.useQuery(
    { paperExamId },
    { enabled: paperExamId > 0, retry: false },
  );

  const { data, isLoading } = trpc.paper.entrySheet.useQuery(
    { paperExamId },
    { enabled: paperExamId > 0, retry: false },
  );

  const enregistrer = trpc.paper.saveEntry.useMutation({
    onSuccess: (r, variables) => {
      setErreur("");
      setEdits(null); // la base fait foi après enregistrement
      setNotesRedigees(null);
      // On épingle l'élève : sans cela, la sélection dérivée « premier non
      // saisi » bascule sur quelqu'un d'autre au moment même où la copie
      // devient saisie, et la note qu'on vient de produire disparaît de l'écran.
      setStudentId(variables.studentId);
      setDernierScore(`${r.normalizedScore}/20 — ${r.totalScore}/${r.maxScore} points`);
      utils.paper.entrySheet.invalidate({ paperExamId });
    },
    onError: (e) => setErreur(e.message),
  });

  // À l'ouverture, on se place sur le premier élève non saisi : c'est l'ordre
  // dans lequel une pile de copies se dépouille.
  const copieCourante =
    (studentId !== null
      ? data?.copies.find((c) => c.studentId === studentId)
      : data?.copies.find((c) => !c.entered) ?? data?.copies[0]) ?? null;

  const answers = useMemo(
    () => edits ?? copieCourante?.answers ?? {},
    [edits, copieCourante],
  );

  const selectionner = useCallback((id: number) => {
    setStudentId(id);
    setEdits(null);
    setNotesRedigees(null);
    setCurseur(0);
    setDernierScore(null);
    setErreur("");
    grilleRef.current?.focus();
  }, []);

  // Mémoïsées : sans cela, `?? []` crée un tableau à chaque rendu et les
  // callbacks qui en dépendent sont recréés inutilement.
  const questions = useMemo(() => data?.questions ?? [], [data]);
  const redigees = useMemo(() => data?.openQuestions ?? [], [data]);

  const notes = useMemo(() => {
    if (notesRedigees) return notesRedigees;
    const depuisBase: Record<number, string> = {};
    for (const [id, v] of Object.entries(copieCourante?.openMarks ?? {})) {
      depuisBase[Number(id)] = String(v);
    }
    return depuisBase;
  }, [notesRedigees, copieCourante]);

  const poserNote = (questionId: number, valeur: string) =>
    setNotesRedigees((prev) => ({ ...(prev ?? notes), [questionId]: valeur }));

  const poser = useCallback(
    (index: number, choix: number | null) => {
      const q = questions[index];
      if (!q) return;
      setEdits((prev) => ({ ...(prev ?? copieCourante?.answers ?? {}), [q.id]: choix }));
      if (choix !== null && index < questions.length - 1) setCurseur(index + 1);
    },
    [questions, copieCourante],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const q = questions[curseur];
      if (!q) return;

      const touche = e.key.toUpperCase();
      const parLettre = LETTRES.indexOf(touche);
      const parChiffre = /^[1-9]$/.test(touche) ? parseInt(touche, 10) - 1 : -1;
      const choix = parLettre >= 0 ? parLettre : parChiffre;

      if (choix >= 0 && choix < q.choiceCount) {
        e.preventDefault();
        poser(curseur, choix);
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete" || touche === "0") {
        e.preventDefault();
        poser(curseur, null);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        setCurseur((c) => Math.min(questions.length - 1, c + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCurseur((c) => Math.max(0, c - 1));
      }
    },
    [curseur, questions, poser],
  );

  const remplies = useMemo(
    () => questions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== null).length,
    [questions, answers],
  );

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Chargement…</div>;

  if (!data) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm">
          Ce tirage n'est pas saisissable : il n'a pas encore été généré.
        </p>
        <Button asChild variant="outline">
          <Link to="/teacher/evaluations">Retour aux évaluations</Link>
        </Button>
      </div>
    );
  }

  const saisies = data.copies.filter((c) => c.entered).length;

  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
          <Link to="/teacher/evaluations">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Mes évaluations
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          Saisie des copies
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {data.exam.evaluationTitle} · {data.exam.className}
          {data.exam.label ? ` · ${data.exam.label}` : ""} · {saisies}/{data.copies.length} copie
          {data.copies.length > 1 ? "s" : ""} saisie{saisies > 1 ? "s" : ""}
        </p>
      </div>

      {erreur && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {erreur}
        </div>
      )}

      {resultats && resultats.stats.entered > 0 && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-slate-50 px-4 py-2.5 text-sm">
          <span>
            Moyenne <strong>{resultats.stats.average}/20</strong>
          </span>
          <span className="text-muted-foreground">
            min {resultats.stats.min} · max {resultats.stats.max}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/teacher/correction/${paperExamId}`}>
                <PenLine className="h-4 w-4 mr-1.5" /> Corriger les copies
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/paper/${paperExamId}/resultats.pdf`} target="_blank" rel="noreferrer">
                <Download className="h-4 w-4 mr-1.5" /> Relevé de notes (PDF)
              </a>
            </Button>
            {/*
              Le tableur est produit par le serveur, comme le PDF : même source
              de données, même contrôle de propriété, même relevé. Une seconde
              mise en forme côté navigateur finissait par diverger — il lui
              manquait la moyenne, le contexte de l'évaluation et la mention des
              reprises manuelles.
            */}
            <Button asChild variant="outline" size="sm">
              <a href={`/api/paper/${paperExamId}/resultats.csv`}>
                <Download className="h-4 w-4 mr-1.5" /> Notes (CSV)
              </a>
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* ── Élèves ── */}
        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Users className="h-4 w-4" /> Élèves
            </CardTitle>
            <Progress value={(saisies / Math.max(1, data.copies.length)) * 100} className="h-1.5 mt-2" />
          </CardHeader>
          <CardContent className="p-2 space-y-0.5 max-h-[70vh] overflow-y-auto">
            {data.copies.map((c) => (
              <button
                key={c.studentId}
                onClick={() => selectionner(c.studentId)}
                className={`w-full text-left px-2.5 py-1.5 rounded-md text-sm flex items-center gap-2 transition-colors ${
                  copieCourante?.studentId === c.studentId
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                }`}
              >
                <span className="text-xs opacity-60 w-5 shrink-0">{c.copyNumber}</span>
                <span className="truncate flex-1">{c.name}</span>
                {c.entered && (
                  <span
                    className={`text-xs shrink-0 ${
                      copieCourante?.studentId === c.studentId ? "" : "text-green-700"
                    }`}
                  >
                    {c.normalizedScore !== null ? c.normalizedScore : <Check className="h-3.5 w-3.5" />}
                  </span>
                )}
              </button>
            ))}
          </CardContent>
        </Card>

        {/* ── Grille ── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">
                  {copieCourante?.name ?? "Sélectionnez un élève"}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                  <Keyboard className="h-3.5 w-3.5" />
                  Tapez la lettre : la réponse est posée et la ligne suivante s'active.
                  Retour arrière pour effacer, flèches pour naviguer.
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0">
                {remplies}/{questions.length}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            <div
              ref={grilleRef}
              tabIndex={0}
              onKeyDown={onKeyDown}
              className="space-y-1 outline-none focus:ring-2 focus:ring-ring rounded-lg p-1"
            >
              {questions.map((q, index) => {
                const choisi = answers[q.id];
                const actif = index === curseur;
                return (
                  <div
                    key={q.id}
                    onClick={() => setCurseur(index)}
                    className={`flex items-center gap-2 rounded-md px-2 py-1 cursor-pointer ${
                      actif ? "bg-sky-50 ring-1 ring-sky-300" : ""
                    }`}
                  >
                    <span className="text-xs font-semibold text-muted-foreground w-7 shrink-0">
                      {String(q.position).padStart(2, "0")}
                    </span>
                    <div className="flex gap-1 shrink-0">
                      {Array.from({ length: q.choiceCount }).map((_, i) => (
                        <button
                          key={i}
                          onClick={(e) => { e.stopPropagation(); poser(index, choisi === i ? null : i); }}
                          className={`h-7 w-7 rounded border text-xs font-medium transition-colors ${
                            choisi === i
                              ? "bg-slate-900 text-white border-slate-900"
                              : "bg-white hover:bg-slate-100"
                          }`}
                          aria-label={`Question ${q.position}, réponse ${LETTRES[i]}`}
                        >
                          {LETTRES[i]}
                        </button>
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                      <MathLatex tex={q.text} auto />
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {q.points} pt{q.points > 1 ? "s" : ""}
                    </span>
                  </div>
                );
              })}
            </div>

            {redigees.length > 0 && (
              <div className="border-t pt-3 space-y-2">
                <p className="text-sm font-medium">
                  Questions rédigées — à corriger sur la copie
                </p>
                <p className="text-xs text-muted-foreground -mt-1">
                  Elles ne figurent pas sur la feuille-réponses : sans note saisie
                  ici, leurs points ne sont pas comptés dans le barème.
                </p>
                {redigees.map((q) => (
                  <div key={q.id} className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={q.points}
                      step={0.25}
                      value={notes[q.id] ?? ""}
                      onChange={(e) => poserNote(q.id, e.target.value)}
                      placeholder="—"
                      className="h-8 w-20 rounded border px-2 text-sm text-right"
                      aria-label={`Points attribués, question rédigée ${q.id}`}
                    />
                    <span className="text-xs text-muted-foreground shrink-0">
                      / {q.points}
                    </span>
                    <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                      <MathLatex tex={q.text} auto />
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 border-t pt-3">
              <Button
                disabled={!copieCourante || enregistrer.isPending}
                onClick={() =>
                  enregistrer.mutate({
                    paperExamId,
                    studentId: copieCourante!.studentId,
                    answers: questions.map((q) => ({
                      questionId: q.id,
                      choiceIndex: answers[q.id] ?? null,
                    })),
                    openMarks: redigees
                      .filter((q) => (notes[q.id] ?? "").trim() !== "")
                      .map((q) => ({
                        questionId: q.id,
                        score: Number((notes[q.id] ?? "0").replace(",", ".")) || 0,
                      })),
                  })
                }
              >
                <Save className="h-4 w-4 mr-1.5" />
                {enregistrer.isPending ? "Enregistrement…" : "Valider et noter"}
              </Button>

              {dernierScore && (
                <span className="text-sm font-medium text-green-700">{dernierScore}</span>
              )}
              {copieCourante?.entered && !dernierScore && (
                <span className="text-sm text-muted-foreground">
                  Déjà saisie
                  {copieCourante.normalizedScore !== null
                    ? ` — ${copieCourante.normalizedScore}/20`
                    : ""}
                  . La revalidation remplace la note.
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


