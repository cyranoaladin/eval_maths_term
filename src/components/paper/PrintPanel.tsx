/**
 * src/components/paper/PrintPanel.tsx
 *
 * Production des documents imprimables d'une évaluation.
 *
 * Le tirage s'adresse à une classe : AMC produit une copie nominative par
 * élève, avec sa feuille-réponses. La classe et sa liste se créent ici même —
 * sans liste d'élèves, il n'y a rien à imprimer.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Download, FileText, Printer, ShieldCheck, Upload, UserX, Users, X } from "lucide-react";
import { trpc } from "@/providers/trpc-client";

interface Props {
  evaluationId: number;
  onClose: () => void;
}

interface Telechargement {
  file: string;
  label: string;
  url: string;
  bytes: number;
}

export function PrintPanel({ evaluationId, onClose }: Props) {
  const utils = trpc.useUtils();
  const [classId, setClassId] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [erreur, setErreur] = useState("");
  const [downloads, setDownloads] = useState<Telechargement[]>([]);
  const [ecartees, setEcartees] = useState<Array<{ id: number; reason: string }>>([]);

  const [nouvelleClasse, setNouvelleClasse] = useState("");
  const [csv, setCsv] = useState("");
  const [importInfo, setImportInfo] = useState("");

  const [rgptOuvert, setRgptOuvert] = useState(false);
  const [messageRgpd, setMessageRgpd] = useState("");

  const { data: amc } = trpc.paper.status.useQuery();
  const { data: classesList } = trpc.paper.listClasses.useQuery();
  const { data: exams } = trpc.paper.listExams.useQuery({ evaluationId });

  const onErreur = (e: { message: string }) => setErreur(e.message);
  const rafraichirClasses = () => utils.paper.listClasses.invalidate();

  const creerClasse = trpc.paper.createClass.useMutation({
    onSuccess: ({ id }) => { setClassId(id); setNouvelleClasse(""); setErreur(""); rafraichirClasses(); },
    onError: onErreur,
  });

  const importer = trpc.paper.importStudents.useMutation({
    onSuccess: (r) => {
      setErreur("");
      setCsv("");
      setImportInfo(
        `${r.inserted} élève${r.inserted > 1 ? "s" : ""} importé${r.inserted > 1 ? "s" : ""}` +
          (r.alreadyPresent ? ` · ${r.alreadyPresent} déjà présent${r.alreadyPresent > 1 ? "s" : ""}` : "") +
          (r.skipped.length ? ` · ${r.skipped.length} ligne(s) écartée(s) : ${r.skipped.map((s) => `L${s.line} ${s.reason}`).join(", ")}` : ""),
      );
      rafraichirClasses();
    },
    onError: onErreur,
  });

  const generer = trpc.paper.createAndGenerate.useMutation({
    onSuccess: (r) => {
      setErreur("");
      setDownloads(r.downloads);
      setEcartees(r.excluded);
      utils.paper.listExams.invalidate({ evaluationId });
    },
    onError: onErreur,
  });

  const classeChoisie = classesList?.find((c) => c.id === classId);

  const { data: eleves } = trpc.paper.listStudents.useQuery(
    { classId: classId ?? 0 },
    { enabled: rgptOuvert && classId !== null },
  );

  const utilsRgpd = trpc.useUtils();

  const anonymiser = trpc.paper.anonymizeStudent.useMutation({
    onSuccess: (r) => {
      setMessageRgpd(
        `Anonymisé sous « ${r.pseudonyme} » — ${r.copiesConservees} copie(s) et leurs notes conservées.`,
      );
      utilsRgpd.paper.listStudents.invalidate({ classId: classId ?? 0 });
      utilsRgpd.paper.listClasses.invalidate();
    },
    onError: (e) => setMessageRgpd(e.message),
  });

  /** Télécharge l'export d'un élève sous forme de fichier JSON lisible. */
  async function telechargerExport(studentId: number, nom: string) {
    setMessageRgpd("");
    try {
      const donnees = await utilsRgpd.paper.exportStudentData.fetch({ studentId });
      const blob = new Blob([JSON.stringify(donnees, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `donnees-${nom.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessageRgpd(`Export produit pour ${nom}.`);
    } catch (e) {
      setMessageRgpd(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card className="border-sky-200">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Printer className="h-4 w-4 text-sky-600" /> Imprimer cette évaluation
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Une copie nominative par élève, avec feuille-réponses détachable.
              Le sujet est identique pour tous : c'est ce qui rend la saisie manuelle possible.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {amc && !amc.amcAvailable && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              <code>auto-multiple-choice</code> n'est pas installé sur ce serveur.
              L'impression restera indisponible tant qu'il manquera.
            </span>
          </div>
        )}

        {erreur && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {erreur}
          </div>
        )}

        {/* ── Classe ── */}
        <div className="space-y-2">
          <Label>Classe</Label>
          {classesList && classesList.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {classesList.map((c) => (
                <Button
                  key={c.id}
                  type="button"
                  size="sm"
                  variant={classId === c.id ? "default" : "outline"}
                  onClick={() => { setClassId(c.id); setImportInfo(""); }}
                >
                  <Users className="h-3.5 w-3.5 mr-1.5" />
                  {c.name}
                  <span className="ml-1.5 opacity-70">{c.studentCount}</span>
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucune classe pour l'instant.</p>
          )}

          <div className="flex gap-2 pt-1">
            <Input
              value={nouvelleClasse}
              onChange={(e) => setNouvelleClasse(e.target.value)}
              placeholder="Nouvelle classe : Terminale EDS G6"
              className="max-w-sm"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={nouvelleClasse.trim().length === 0 || creerClasse.isPending}
              onClick={() => creerClasse.mutate({ name: nouvelleClasse.trim() })}
            >
              Créer
            </Button>
          </div>
        </div>

        {/* ── Liste d'élèves ── */}
        {classId && (
          <div className="space-y-2 rounded-lg border p-3">
            <Label htmlFor="csv" className="flex items-center gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              Liste d'élèves de « {classeChoisie?.name} » — {classeChoisie?.studentCount ?? 0} inscrit(s)
            </Label>
            <Textarea
              id="csv"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder={"Collez l'export de la vie scolaire (CSV).\nUne colonne « Eleves » ou « Nom » suffit."}
              className="min-h-[90px] font-mono text-xs"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={csv.trim().length === 0 || importer.isPending}
                onClick={() => importer.mutate({ classId, csv })}
              >
                {importer.isPending ? "Import…" : "Importer"}
              </Button>
              {importInfo && <span className="text-xs text-muted-foreground">{importInfo}</span>}
            </div>
          </div>
        )}

        {/* ── Génération ── */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="label">Intitulé du tirage (facultatif)</Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Devoir surveillé — mai 2026"
              className="w-72"
            />
          </div>
          <Button
            disabled={!classId || (classeChoisie?.studentCount ?? 0) === 0 || generer.isPending || amc?.amcAvailable === false}
            onClick={() => generer.mutate({ evaluationId, classId: classId!, label: label.trim() || undefined })}
          >
            <Printer className="h-4 w-4 mr-1.5" />
            {generer.isPending ? "Composition…" : "Générer les documents"}
          </Button>
          {classId && (classeChoisie?.studentCount ?? 0) === 0 && (
            <span className="text-xs text-amber-700">
              Importez d'abord la liste d'élèves : sans elle, il n'y a rien à imprimer.
            </span>
          )}
        </div>

        {ecartees.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-medium">
              {ecartees.length} question(s) absente(s) de la feuille-réponses :
            </p>
            <p className="mt-0.5">
              {ecartees[0].reason} Elles restent imprimées mais devront être corrigées à part.
            </p>
          </div>
        )}

        {downloads.length > 0 && (
          <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
            <p className="text-sm font-medium">Documents prêts</p>
            <div className="flex flex-wrap gap-2">
              {downloads.map((d) => (
                <Button key={d.file} asChild variant="outline" size="sm">
                  <a href={d.url} target="_blank" rel="noreferrer">
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    {d.label}
                    <span className="ml-1.5 text-xs opacity-60">
                      {(d.bytes / 1024).toFixed(0)} ko
                    </span>
                  </a>
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* ── Données personnelles ── */}
        {classId && (
          <div className="rounded-lg border">
            <button
              type="button"
              onClick={() => { setRgptOuvert((v) => !v); setMessageRgpd(""); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/40 rounded-lg"
            >
              <ShieldCheck className="h-4 w-4 text-slate-500" />
              <span>Données personnelles des élèves</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {rgptOuvert ? "masquer" : "accès et effacement"}
              </span>
            </button>

            {rgptOuvert && (
              <div className="border-t px-3 py-2 space-y-2">
                <p className="text-xs text-muted-foreground">
                  L'effacement prend la forme d'une anonymisation : l'identité est
                  retirée, les notes des évaluations rendues sont conservées.
                  L'opération est irréversible.
                </p>
                {messageRgpd && (
                  <p className="text-xs rounded border bg-slate-50 px-2 py-1.5">{messageRgpd}</p>
                )}
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {eleves?.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 text-sm py-0.5">
                      <span className="truncate flex-1">
                        {e.lastName} {e.firstName}
                        {!e.active && (
                          <span className="ml-1.5 text-xs text-muted-foreground">(anonymisé)</span>
                        )}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => telechargerExport(e.id, `${e.lastName} ${e.firstName}`)}
                      >
                        <Download className="h-3.5 w-3.5 mr-1" /> Exporter
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-destructive"
                        disabled={!e.active || anonymiser.isPending}
                        onClick={() => anonymiser.mutate({ studentId: e.id })}
                      >
                        <UserX className="h-3.5 w-3.5 mr-1" /> Anonymiser
                      </Button>
                    </div>
                  ))}
                  {eleves?.length === 0 && (
                    <p className="text-xs text-muted-foreground py-2">
                      Aucun élève dans cette classe.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {exams && exams.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Tirages précédents</p>
            {exams.map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-sm">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{e.label ?? `Tirage #${e.id}`}</span>
                <span className="text-muted-foreground">{e.className}</span>
                <Badge variant="secondary" className="text-xs">
                  {e.copyCount} copie{e.copyCount > 1 ? "s" : ""}
                </Badge>
                <a
                  href={`/api/paper/${e.id}/sujet.pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-sky-700 hover:underline ml-auto"
                >
                  Sujet
                </a>
                <a
                  href={`/api/paper/${e.id}/corrige.pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-sky-700 hover:underline"
                >
                  Corrigé
                </a>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
