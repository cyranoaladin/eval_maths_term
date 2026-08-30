/**
 * src/pages/teacher/Evaluations.tsx
 *
 * Liste des évaluations de l'enseignant : création, duplication, activation,
 * suppression. Point d'entrée de l'atelier de rédaction des QCM.
 */
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Copy, FileText, Plus, Printer, Trash2, Globe } from "lucide-react";
import { trpc } from "@/providers/trpc-client";

type DeliveryMode = "online" | "paper" | "both";

const MODE_LABELS: Record<DeliveryMode, { label: string; icon: typeof Globe }> = {
  online: { label: "En ligne", icon: Globe },
  paper: { label: "Papier", icon: Printer },
  both: { label: "Papier et en ligne", icon: FileText },
};

export default function Evaluations() {
  const utils = trpc.useUtils();
  const { data: evaluations, isLoading } = trpc.authoring.listEvaluations.useQuery();

  const [open, setOpen] = useState(false);
  const [titre, setTitre] = useState("");
  const [description, setDescription] = useState("");
  const [duree, setDuree] = useState(60);
  const [mode, setMode] = useState<DeliveryMode>("paper");
  const [erreur, setErreur] = useState("");

  const invalider = () => utils.authoring.listEvaluations.invalidate();
  const onErreur = (e: { message: string }) => setErreur(e.message);

  const creer = trpc.authoring.createEvaluation.useMutation({
    onSuccess: () => { setOpen(false); setTitre(""); setDescription(""); invalider(); },
    onError: onErreur,
  });
  const dupliquer = trpc.authoring.duplicateEvaluation.useMutation({
    onSuccess: invalider, onError: onErreur,
  });
  const supprimer = trpc.authoring.deleteEvaluation.useMutation({
    onSuccess: invalider, onError: onErreur,
  });
  const modifier = trpc.authoring.updateEvaluation.useMutation({
    onSuccess: invalider, onError: onErreur,
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Chargement…</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mes évaluations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Rédigez vos QCM, imprimez-les, saisissez les copies.
          </p>
        </div>
        <Button onClick={() => { setErreur(""); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-1.5" /> Nouvelle évaluation
        </Button>
      </div>

      {erreur && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {erreur}
        </div>
      )}

      {evaluations?.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Aucune évaluation pour l'instant.
            </p>
            <Button onClick={() => setOpen(true)} variant="outline">
              <Plus className="h-4 w-4 mr-1.5" /> Créer la première
            </Button>
          </CardContent>
        </Card>
      )}

      {/*
        `min-w-0` sur chaque carte : un élément de grille a par défaut une
        largeur minimale égale à celle de son contenu, et le titre en
        `truncate` — donc en `nowrap` — impose la sienne. Sur une tablette, la
        liste débordait de l'écran vers la droite. La troncature ne peut faire
        son office que si la carte a le droit de rétrécir.
      */}
      <div className="grid gap-3 min-w-0">
        {evaluations?.map((e) => {
          const ModeIcon = MODE_LABELS[e.deliveryMode as DeliveryMode].icon;
          const verrouillee = e.sessionCount > 0;
          return (
            <Card key={e.id} className="min-w-0">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">
                      <Link to={`/teacher/evaluations/${e.id}`} className="hover:underline">
                        {e.title}
                      </Link>
                    </CardTitle>
                    {e.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {e.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={e.isActive ? "default" : "secondary"}>
                      {e.isActive ? "Active" : "Brouillon"}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <ModeIcon className="h-3.5 w-3.5" />
                  {MODE_LABELS[e.deliveryMode as DeliveryMode].label}
                </span>
                <span>{e.questionCount} question{e.questionCount > 1 ? "s" : ""}</span>
                <span>{e.maxScore} point{e.maxScore > 1 ? "s" : ""}</span>
                <span>{e.duration} min</span>
                {verrouillee && (
                  <span className="text-amber-700">
                    {e.sessionCount} copie{e.sessionCount > 1 ? "s" : ""}
                  </span>
                )}

                <div className="ml-auto flex items-center gap-1.5">
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/teacher/evaluations/${e.id}`}>Ouvrir</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setErreur(""); modifier.mutate({ id: e.id, isActive: !e.isActive }); }}
                    disabled={modifier.isPending}
                  >
                    {e.isActive ? "Désactiver" : "Activer"}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Dupliquer"
                    onClick={() => { setErreur(""); dupliquer.mutate({ id: e.id }); }}
                    disabled={dupliquer.isPending}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Supprimer"
                    title={verrouillee ? "Des copies existent : désactivez-la plutôt" : "Supprimer"}
                    onClick={() => { setErreur(""); supprimer.mutate({ id: e.id }); }}
                    disabled={supprimer.isPending || verrouillee}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle évaluation</DialogTitle>
            <DialogDescription>
              Elle démarre en brouillon : ajoutez des questions avant de l'activer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="titre">Titre</Label>
              <Input
                id="titre"
                value={titre}
                onChange={(ev) => setTitre(ev.target.value)}
                placeholder="QCM Automatismes — Suites"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="desc">Description (facultative)</Label>
              <Textarea
                id="desc"
                value={description}
                onChange={(ev) => setDescription(ev.target.value)}
                className="min-h-[60px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="duree">Durée (minutes)</Label>
                <Input
                  id="duree"
                  type="number"
                  min={5}
                  max={300}
                  value={duree}
                  onChange={(ev) => setDuree(parseInt(ev.target.value, 10) || 60)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Passation</Label>
                <div className="flex gap-1">
                  {(Object.keys(MODE_LABELS) as DeliveryMode[]).map((m) => (
                    <Button
                      key={m}
                      type="button"
                      size="sm"
                      variant={mode === m ? "default" : "outline"}
                      className="flex-1 text-xs"
                      onClick={() => setMode(m)}
                    >
                      {m === "online" ? "En ligne" : m === "paper" ? "Papier" : "Les deux"}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <Button
              className="w-full"
              disabled={titre.trim().length === 0 || creer.isPending}
              onClick={() =>
                creer.mutate({
                  title: titre.trim(),
                  description: description.trim() || undefined,
                  duration: duree,
                  deliveryMode: mode,
                })
              }
            >
              {creer.isPending ? "Création…" : "Créer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
