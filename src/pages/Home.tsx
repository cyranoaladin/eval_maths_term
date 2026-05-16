import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Clock, ShieldCheck, BookOpen, Calculator, Eye } from "lucide-react";
import { trpc } from "@/providers/trpc-client";
import { EVALUATION_DURATION } from "@contracts/evaluation-data";

export default function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { data: evaluations, isLoading: isLoadingEvals } = trpc.evaluation.list.useQuery();
  const createSession = trpc.evaluation.createSession.useMutation();

  const handleStart = async () => {
    if (!name.trim()) {
      setError("Veuillez entrer votre nom et prénom.");
      return;
    }

    setError("");
    setIsLoading(true);

    try {
      const evaluation = evaluations?.[0];

      if (!evaluation) {
        setError("Aucune évaluation disponible. Contactez votre enseignant.");
        setIsLoading(false);
        return;
      }

      const session = await createSession.mutateAsync({
        evaluationId: evaluation.id,
        studentName: name.trim(),
        studentEmail: email.trim() || undefined,
      });

      navigate(`/evaluation?session=${session.sessionId}&eval=${evaluation.id}`);
    } catch (err) {
      setError("Une erreur est survenue. Veuillez réessayer.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="max-w-4xl w-full space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-800 px-4 py-2 rounded-full text-sm font-medium">
            <BookOpen className="w-4 h-4" />
            Évaluation en ligne
          </div>
          <h1 className="text-4xl font-bold text-slate-900">
            Évaluation de Mathématiques
          </h1>
          <p className="text-lg text-slate-600">
            Terminale — Enseignement de Spécialité (EDS)
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Info Card */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="w-5 h-5 text-blue-600" />
                Informations
              </CardTitle>
              <CardDescription>
                Détails de l'évaluation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                <Clock className="w-5 h-5 text-blue-600" />
                <div>
                  <p className="font-medium text-slate-900">Durée</p>
                  <p className="text-sm text-slate-600">{EVALUATION_DURATION} minutes</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                <BookOpen className="w-5 h-5 text-green-600" />
                <div>
                  <p className="font-medium text-slate-900">Contenu</p>
                  <p className="text-sm text-slate-600">QCM, réponses courtes, vrai/faux</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg">
                <ShieldCheck className="w-5 h-5 text-amber-600" />
                <div>
                  <p className="font-medium text-slate-900">Sécurisée</p>
                  <p className="text-sm text-slate-600">Mode plein écran, détection de triche</p>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="font-medium text-slate-900 mb-2">Thèmes abordés :</p>
                <ul className="text-sm text-slate-600 space-y-1">
                  <li>• Suites et limites</li>
                  <li>• Limites de fonctions</li>
                  <li>• Dérivation et convexité</li>
                  <li>• Fonction logarithme népérien</li>
                  <li>• Intégration et primitives</li>
                  <li>• Équations différentielles</li>
                  <li>• Probabilités et loi binomiale</li>
                </ul>
              </div>

              <Link to="/preview">
                <Button variant="outline" className="w-full">
                  <Eye className="w-4 h-4 mr-2" />
                  Aperçu de l'évaluation (enseignant)
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Registration Card */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>Commencer l'évaluation</CardTitle>
              <CardDescription>
                Entrez vos informations pour démarrer
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="name">Nom et Prénom *</Label>
                <Input
                  id="name"
                  placeholder="Ex: Marie Dupont"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleStart()}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email (optionnel)</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Ex: marie.dupont@lycee.fr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleStart()}
                />
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800 font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Important
                </p>
                <p className="text-xs text-amber-700 mt-1">
                  Une fois démarrée, l'évaluation se lance en mode plein écran.
                  Toute tentative de triche (changement d'onglet, copier-coller, etc.) sera enregistrée.
                </p>
              </div>

              <Button
                onClick={handleStart}
                disabled={isLoading || isLoadingEvals}
                className="w-full"
                size="lg"
              >
                {isLoading || isLoadingEvals ? "Chargement..." : "Démarrer l'évaluation"}
              </Button>

              <Link to="/dashboard" className="block text-center">
                <Button variant="ghost" size="sm" className="text-slate-500">
                  Tableau de bord enseignant
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-slate-500">
          <p>Application d'évaluation sécurisée — Anti-triche activé</p>
        </div>
      </div>
    </div>
  );
}
