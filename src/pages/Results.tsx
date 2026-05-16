import { useSearchParams, Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, XCircle, AlertTriangle, Clock, User, Home, RotateCcw } from "lucide-react";
import { trpc } from "@/providers/trpc-client";

export default function Results() {
  const [searchParams] = useSearchParams();
  const sessionId = parseInt(searchParams.get("session") || "0");

  const { data: result, isLoading } = trpc.evaluation.getResults.useQuery(
    { sessionId },
    { enabled: sessionId > 0 }
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!result || !result.session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card>
          <CardContent className="p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <p>Résultats non trouvés.</p>
            <Link to="/">
              <Button className="mt-4">Retour à l'accueil</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { session, responses } = result;
  const score = session.totalScore || 0;
  const maxScore = session.maxScore || 1;
  const percentage = Math.round((score / maxScore) * 100);
  const timeSpent = session.timeSpent || 0;
  const minutes = Math.floor(timeSpent / 60);
  const seconds = timeSpent % 60;

  const getStatusColor = () => {
    if (session.status === "cheating_detected") return "destructive";
    if (session.status === "timed_out") return "secondary";
    return "default";
  };

  const getStatusLabel = () => {
    if (session.status === "cheating_detected") return "Triche détectée";
    if (session.status === "timed_out") return "Temps écoulé";
    return "Terminé";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-slate-900">Résultats de l'évaluation</h1>
          <p className="text-slate-600">Mathématiques — Terminale Spécialité (EDS)</p>
        </div>

        {/* Score principal */}
        <Card className="shadow-lg">
          <CardContent className="p-8 text-center space-y-6">
            <div className="flex items-center justify-center gap-2 text-slate-500">
              <User className="w-4 h-4" />
              <span className="font-medium">{session.studentName}</span>
            </div>

            <div className={`text-6xl font-bold ${percentage >= 50 ? "text-green-600" : "text-red-600"}`}>
              {score}/{maxScore}
            </div>

            <div className="w-full max-w-md mx-auto">
              <Progress value={percentage} className="h-3" />
              <p className="text-sm text-slate-500 mt-2">{percentage}% de réussite</p>
            </div>

            <div className="flex items-center justify-center gap-4 flex-wrap">
              <Badge variant={getStatusColor() as "default" | "secondary" | "destructive"} className="text-sm px-3 py-1">
                {getStatusLabel()}
              </Badge>
              {session.tabSwitchCount > 0 && (
                <Badge variant="destructive" className="text-sm px-3 py-1">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {session.tabSwitchCount} tentative{session.tabSwitchCount > 1 ? "s" : ""} de triche
                </Badge>
              )}
            </div>

            <div className="flex items-center justify-center gap-2 text-slate-500 text-sm">
              <Clock className="w-4 h-4" />
              <span>
                Temps passé : {minutes} min {seconds} s
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Détails des réponses */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Détail des réponses</CardTitle>
            <CardDescription>
              Vos réponses et la correction
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {responses.map((resp, idx) => (
              <div
                key={resp.id}
                className={`p-4 rounded-lg border ${
                  resp.isCorrect ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="font-medium text-sm mb-2">
                      Question {idx + 1}
                    </p>
                    <p className="text-sm text-slate-600 mb-2">
                      <span className="font-medium">Votre réponse :</span>{" "}
                      {resp.answer || "Non répondu"}
                    </p>
                    {resp.justification && (
                      <p className="text-sm text-slate-600 mb-2">
                        <span className="font-medium">Justification :</span>{" "}
                        {resp.justification}
                      </p>
                    )}
                    {resp.llmFeedback && (
                      <p className="text-xs text-slate-500 italic mt-1">
                        {resp.llmFeedback}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {resp.isCorrect ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600" />
                    )}
                    <span className={`text-sm font-medium ${resp.isCorrect ? "text-green-700" : "text-red-700"}`}>
                      {resp.score}/{resp.maxScore}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Alertes */}
        {session.tabSwitchCount > 0 && (
          <Card className="border-red-300 bg-red-50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="w-5 h-5" />
                <span className="font-medium">
                  {session.tabSwitchCount} comportement{session.tabSwitchCount > 1 ? "s" : ""} suspect{session.tabSwitchCount > 1 ? "s" : ""} détecté{session.tabSwitchCount > 1 ? "s" : ""} pendant l'évaluation
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="flex justify-center gap-4">
          <Link to="/">
            <Button variant="outline">
              <Home className="w-4 h-4 mr-2" />
              Retour à l'accueil
            </Button>
          </Link>
          <Link to="/">
            <Button>
              <RotateCcw className="w-4 h-4 mr-2" />
              Nouvelle évaluation
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
