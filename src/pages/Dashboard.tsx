/**
 * src/pages/Dashboard.tsx
 *
 * Tableau de bord de l'atelier.
 *
 * L'écran précédent venait du produit « examen en ligne » : il affichait des
 * histogrammes de sessions alors que le travail quotidien de l'enseignant est
 * ailleurs — quelles copies restent à saisir, où en sont les tirages, où
 * corriger. Le suivi des épreuves en ligne reste disponible, mais dans un bloc
 * distinct qu'on déplie, parce qu'il ne sert que les jours d'examen.
 */
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ChevronDown, ChevronUp, Download, FilePenLine, FileText, Keyboard,
  Monitor, PenLine, Plus, Printer, Users,
} from "lucide-react";
import { trpc } from "@/providers/trpc-client";
import { LiveDashboard } from "@/components/teacher/LiveDashboard";

export default function Dashboard() {
  const [suiviOuvert, setSuiviOuvert] = useState(false);

  const { data: evaluations } = trpc.authoring.listEvaluations.useQuery();
  const { data: classes } = trpc.paper.listClasses.useQuery();
  const { data: apercu, isLoading } = trpc.paper.overview.useQuery({ limite: 8 });

  const tirages = apercu?.tirages ?? [];
  const aSaisir = tirages.filter((t) => t.restantes > 0);
  const evaluationEnLigne = evaluations?.find(
    (e) => e.isActive && (e.deliveryMode === "online" || e.deliveryMode === "both"),
  );

  const totalCopies = tirages.reduce((s, t) => s + t.copies, 0);
  const totalSaisies = tirages.reduce((s, t) => s + t.saisies, 0);

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Chargement…</div>;
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Vos évaluations, vos classes et l'avancement des corrections.
          </p>
        </div>
        <Button asChild>
          <Link to="/teacher/evaluations">
            <Plus className="h-4 w-4 mr-1.5" /> Nouvelle évaluation
          </Link>
        </Button>
      </div>

      {/* ── Chiffres du moment ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Évaluations</p>
            <p className="text-2xl font-semibold mt-1">{evaluations?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {evaluations?.filter((e) => e.isActive).length ?? 0} active(s)
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Classes</p>
            <p className="text-2xl font-semibold mt-1">{classes?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {classes?.reduce((s, c) => s + c.studentCount, 0) ?? 0} élèves
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Tirages papier</p>
            <p className="text-2xl font-semibold mt-1">{tirages.length}</p>
            <p className="text-xs text-muted-foreground mt-1">{totalCopies} copies</p>
          </CardContent>
        </Card>
        <Card className={aSaisir.length > 0 ? "border-amber-300" : undefined}>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Copies à saisir</p>
            <p className={`text-2xl font-semibold mt-1 ${aSaisir.length > 0 ? "text-amber-700" : ""}`}>
              {totalCopies - totalSaisies}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              sur {tirages.length > 0 ? `${aSaisir.length} tirage(s)` : "aucun tirage"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Tirages ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Printer className="h-4 w-4" /> Tirages papier
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tirages.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Aucun tirage. Ouvrez une évaluation et générez les documents pour commencer.
            </p>
          )}
          {tirages.map((t) => (
            <div key={t.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {t.label ?? `Tirage #${t.id}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.evaluationTitle} · {t.className}
                    {t.generatedAt && ` · ${new Date(t.generatedAt).toLocaleDateString("fr-FR")}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {t.moyenne !== null && (
                    <Badge variant="secondary">Moyenne {t.moyenne}/20</Badge>
                  )}
                  {t.restantes > 0 ? (
                    <Badge variant="outline" className="text-amber-700 border-amber-300">
                      {t.restantes} à saisir
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-green-700 border-green-300">
                      complet
                    </Badge>
                  )}
                </div>
              </div>

              <Progress value={(t.saisies / Math.max(1, t.copies)) * 100} className="h-1.5" />

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">
                  {t.saisies}/{t.copies} copies saisies
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                    <Link to={`/teacher/saisie/${t.id}`}>
                      <Keyboard className="h-3.5 w-3.5 mr-1" /> Saisir
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                    <Link to={`/teacher/correction/${t.id}`}>
                      <PenLine className="h-3.5 w-3.5 mr-1" /> Corriger
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                    <a href={`/api/paper/${t.id}/sujet.pdf`} target="_blank" rel="noreferrer">
                      <FileText className="h-3.5 w-3.5 mr-1" /> Sujet
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                    <a href={`/api/paper/${t.id}/resultats.pdf`} target="_blank" rel="noreferrer">
                      <Download className="h-3.5 w-3.5 mr-1" /> Relevé
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Évaluations ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FilePenLine className="h-4 w-4" /> Évaluations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {(evaluations ?? []).slice(0, 6).map((e) => (
              <Link
                key={e.id}
                to={`/teacher/evaluations/${e.id}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              >
                <span className="truncate flex-1">{e.title}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {e.questionCount} q · {e.maxScore} pts
                </span>
                {!e.isActive && (
                  <Badge variant="secondary" className="text-xs shrink-0">brouillon</Badge>
                )}
              </Link>
            ))}
            {(evaluations ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground py-2">Aucune évaluation.</p>
            )}
          </CardContent>
        </Card>

        {/* ── Dernières notes ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Dernières copies notées
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {(apercu?.derniersResultats ?? []).map((r, i) => (
              <Link
                key={i}
                to={`/teacher/correction/${r.paperExamId}`}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent"
              >
                <span className="truncate flex-1">{r.eleve}</span>
                <span className="font-medium shrink-0">
                  {r.note20 !== null ? `${r.note20}/20` : "—"}
                </span>
              </Link>
            ))}
            {(apercu?.derniersResultats ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground py-2">Aucune copie saisie.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Épreuves en ligne, repliées ── */}
      <Card>
        <CardHeader className="pb-2">
          <button
            type="button"
            onClick={() => setSuiviOuvert((v) => !v)}
            className="w-full flex items-center gap-2 text-left"
          >
            <Monitor className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Épreuves en ligne — suivi en direct</CardTitle>
            <span className="ml-auto text-xs text-muted-foreground">
              {suiviOuvert ? "masquer" : "afficher"}
            </span>
            {suiviOuvert ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {!suiviOuvert && (
            <p className="text-xs text-muted-foreground">
              Surveillance des compositions en cours, score de suspicion et soumission forcée.
              Utile le jour d'une épreuve surveillée.
            </p>
          )}
        </CardHeader>
        {suiviOuvert && (
          <CardContent>
            {evaluationEnLigne ? (
              <LiveDashboard evaluationId={evaluationEnLigne.id} />
            ) : (
              <p className="text-sm text-muted-foreground py-2">
                Aucune évaluation active en mode en ligne.
              </p>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
