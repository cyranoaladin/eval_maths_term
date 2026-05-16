import { useState, useCallback, useRef, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, Clock, Eye, ChevronLeft, ChevronRight, Send } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc-client";
import { useAntiCheat } from "@/hooks/useAntiCheat";
import { useTimer } from "@/hooks/useTimer";
import type { CheatEvent } from "@contracts/types";
import { EVALUATION_DURATION } from "@contracts/evaluation-data";

export default function Evaluation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = parseInt(searchParams.get("session") || "0");
  const evaluationId = parseInt(searchParams.get("eval") || "0");

  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<number, { answer: string; justification?: string }>>({});
  const [cheatEvents, setCheatEvents] = useState<CheatEvent[]>([]);
  const [showWarning, setShowWarning] = useState(false);
  const [warningMessage, setWarningMessage] = useState("");
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isStarted, setIsStarted] = useState(false);

  const answersRef = useRef(answers);
  const handleSubmitRef = useRef<(isTimeout?: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    answersRef.current = answers;
  });

  // Récupérer les questions
  const { data: questions, isLoading } = trpc.evaluation.getQuestions.useQuery(
    { evaluationId },
    { enabled: evaluationId > 0 }
  );

  // Mutations
  const updateSession = trpc.evaluation.updateSession.useMutation();
  const submitAnswers = trpc.evaluation.submitAnswers.useMutation();

  const { formattedTime, progress, isWarning, isCritical, getTimeSpent } = useTimer({
    durationMinutes: EVALUATION_DURATION,
    onTimeUp: useCallback(() => {
      if (!isSubmitted) {
        handleSubmitRef.current(true);
      }
    }, [isSubmitted]),
    isRunning: isStarted && !isSubmitted,
  });

  // Soumettre les réponses
  const handleSubmit = useCallback(async (isTimeout = false) => {
    if (!questions || !sessionId) return;

    setIsSubmitted(true);

    const formattedAnswers = questions.map((q) => ({
      questionId: q.id,
      answer: answersRef.current[q.id]?.answer || "",
      justification: answersRef.current[q.id]?.justification,
    }));

    try {
      await submitAnswers.mutateAsync({
        sessionId,
        answers: formattedAnswers,
      });

      await updateSession.mutateAsync({
        sessionId,
        status: isTimeout ? "timed_out" : cheatEvents.length > 5 ? "cheating_detected" : "completed",
        timeSpent: getTimeSpent(),
      });

      navigate(`/results?session=${sessionId}`);
    } catch (err) {
      console.error("Error submitting:", err);
    }
  }, [questions, sessionId, submitAnswers, updateSession, getTimeSpent, navigate, cheatEvents]);

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  });

  // Anti-triche
  const handleCheatDetected = useCallback((event: CheatEvent) => {
    setCheatEvents((prev) => [...prev, event]);

    let message = "";
    switch (event.type) {
      case "tab_switch":
        message = `Changement d'onglet détecté ! (${cheatEvents.length} tentative${cheatEvents.length > 1 ? "s" : ""})`;
        break;
      case "blur":
        message = `Perte de focus détectée ! (${cheatEvents.length} tentative${cheatEvents.length > 1 ? "s" : ""})`;
        break;
      case "context_menu":
        message = "Clic droit interdit !";
        break;
      case "copy":
        message = "Copier est interdit !";
        break;
      case "paste":
        message = "Coller est interdit !";
        break;
      case "fullscreen_exit":
        message = "Sortie du plein écran détectée !";
        break;
      case "print":
        message = "Impression interdite !";
        break;
    }

    setWarningMessage(message);
    setShowWarning(true);

    // Envoyer l'événement au serveur
    if (sessionId) {
      updateSession.mutate({
        sessionId,
        tabSwitchCount: cheatEvents.length,
      });
    }

    // Masquer l'avertissement après 3 secondes
    setTimeout(() => setShowWarning(false), 3000);
  }, [sessionId, cheatEvents, updateSession]);

  const { enterFullscreen } = useAntiCheat({
    enabled: isStarted && !isSubmitted,
    sessionToken: "",
    onCheatDetected: handleCheatDetected,
    onFullscreenExit: () => {
      // Demander à l'utilisateur de revenir en plein écran
      setTimeout(() => {
        enterFullscreen();
      }, 500);
    },
  });

  // Démarrer l'évaluation
  const handleStart = async () => {
    await enterFullscreen();
    setIsStarted(true);
  };

  const handleAnswer = (questionId: number, answer: string) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: { ...prev[questionId], answer },
    }));
  };

  const handleJustification = (questionId: number, justification: string) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: { ...prev[questionId], justification },
    }));
  };

  const goToNext = () => {
    if (questions && currentQuestion < questions.length - 1) {
      setCurrentQuestion((prev) => prev + 1);
    }
  };

  const goToPrevious = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion((prev) => prev - 1);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!questions || questions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card>
          <CardContent className="p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <p>Impossible de charger l'évaluation.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentQ = questions[currentQuestion];
  const answeredCount = Object.keys(answers).filter((k) => answers[parseInt(k)]?.answer !== "").length;

  // Écran de démarrage
  if (!isStarted) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Prêt à commencer ?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                <Clock className="w-5 h-5 text-blue-600" />
                <p className="text-sm">Durée : {EVALUATION_DURATION} minutes</p>
              </div>
              <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                <Eye className="w-5 h-5 text-green-600" />
                <p className="text-sm">{questions.length} questions à répondre</p>
              </div>
              <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <p className="text-sm">Mode plein écran obligatoire</p>
              </div>
            </div>
            <Button onClick={handleStart} className="w-full" size="lg">
              Démarrer l'évaluation
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Barre supérieure */}
      <div className={`sticky top-0 z-50 border-b ${isCritical ? "bg-red-600 text-white" : isWarning ? "bg-amber-500 text-white" : "bg-white"} shadow-sm transition-colors duration-300`}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Badge variant={isCritical ? "destructive" : "secondary"} className="text-lg px-3 py-1">
              <Clock className="w-4 h-4 mr-2" />
              {formattedTime}
            </Badge>
            <span className={`text-sm font-medium ${isCritical ? "text-white" : "text-slate-600"}`}>
              Question {currentQuestion + 1} / {questions.length}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className={`text-sm ${isCritical ? "text-white" : "text-slate-500"}`}>
              {answeredCount}/{questions.length} répondues
            </span>
            {cheatEvents.length > 0 && (
              <Badge variant="destructive" className="animate-pulse">
                <AlertTriangle className="w-3 h-3 mr-1" />
                {cheatEvents.length} alerte{cheatEvents.length > 1 ? "s" : ""}
              </Badge>
            )}
            <Button
              variant="default"
              size="sm"
              onClick={() => setShowSubmitConfirm(true)}
              className="bg-green-600 hover:bg-green-700"
            >
              <Send className="w-4 h-4 mr-1" />
              Terminer
            </Button>
          </div>
        </div>
        <Progress value={progress} className="h-1 rounded-none" />
      </div>

      {/* Avertissement anti-triche */}
      {showWarning && (
        <div className="fixed top-16 left-1/2 transform -translate-x-1/2 z-50 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg animate-bounce">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-medium">{warningMessage}</span>
          </div>
        </div>
      )}

      {/* Contenu principal */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="grid md:grid-cols-4 gap-6">
          {/* Navigation des questions */}
          <div className="md:col-span-1">
            <Card className="sticky top-24">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Questions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2">
                  {questions.map((q, idx) => {
                    const isAnswered = !!answers[q.id]?.answer;
                    const isCurrent = idx === currentQuestion;
                    return (
                      <button
                        key={q.id}
                        onClick={() => setCurrentQuestion(idx)}
                        className={`w-full aspect-square rounded-lg text-sm font-medium transition-all ${
                          isCurrent
                            ? "bg-blue-600 text-white ring-2 ring-blue-300"
                            : isAnswered
                            ? "bg-green-100 text-green-800 border border-green-300"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Question courante */}
          <div className="md:col-span-3">
            <Card className="shadow-lg">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">
                    {currentQ.type === "qcm"
                      ? "QCM"
                      : currentQ.type === "short_answer"
                      ? "Réponse courte"
                      : "Vrai / Faux"}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {currentQ.points} point{currentQ.points > 1 ? "s" : ""}
                  </Badge>
                </div>
                <CardTitle className="text-lg mt-2 leading-relaxed">
                  {currentQ.question}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* QCM */}
                {currentQ.type === "qcm" && currentQ.options && (
                  <RadioGroup
                    value={answers[currentQ.id]?.answer || ""}
                    onValueChange={(value) => handleAnswer(currentQ.id, value)}
                  >
                    <div className="space-y-3">
                      {currentQ.options.map((option: string, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-slate-50 transition-colors cursor-pointer"
                          onClick={() => handleAnswer(currentQ.id, String(idx))}
                        >
                          <RadioGroupItem value={String(idx)} id={`q-${currentQ.id}-opt-${idx}`} />
                          <Label
                            htmlFor={`q-${currentQ.id}-opt-${idx}`}
                            className="cursor-pointer flex-1"
                          >
                            {option}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </RadioGroup>
                )}

                {/* Réponse courte */}
                {currentQ.type === "short_answer" && (
                  <div className="space-y-2">
                    <Label htmlFor={`answer-${currentQ.id}`}>Votre réponse :</Label>
                    <Textarea
                      id={`answer-${currentQ.id}`}
                      placeholder="Entrez votre réponse ici..."
                      value={answers[currentQ.id]?.answer || ""}
                      onChange={(e) => handleAnswer(currentQ.id, e.target.value)}
                      className="min-h-[100px]"
                    />
                  </div>
                )}

                {/* Vrai/Faux */}
                {currentQ.type === "true_false" && (
                  <div className="space-y-4">
                    <RadioGroup
                      value={answers[currentQ.id]?.answer || ""}
                      onValueChange={(value) => handleAnswer(currentQ.id, value)}
                    >
                      <div className="flex gap-4">
                        <div
                          className="flex items-center space-x-2 p-4 rounded-lg border hover:bg-slate-50 cursor-pointer"
                          onClick={() => handleAnswer(currentQ.id, "true")}
                        >
                          <RadioGroupItem value="true" id={`q-${currentQ.id}-true`} />
                          <Label htmlFor={`q-${currentQ.id}-true`} className="cursor-pointer font-medium">
                            Vrai
                          </Label>
                        </div>
                        <div
                          className="flex items-center space-x-2 p-4 rounded-lg border hover:bg-slate-50 cursor-pointer"
                          onClick={() => handleAnswer(currentQ.id, "false")}
                        >
                          <RadioGroupItem value="false" id={`q-${currentQ.id}-false`} />
                          <Label htmlFor={`q-${currentQ.id}-false`} className="cursor-pointer font-medium">
                            Faux
                          </Label>
                        </div>
                      </div>
                    </RadioGroup>

                    {currentQ.justificationRequired && (
                      <div className="space-y-2">
                        <Label htmlFor={`justif-${currentQ.id}`}>
                          Justification (obligatoire) :
                        </Label>
                        <Textarea
                          id={`justif-${currentQ.id}`}
                          placeholder="Justifiez votre réponse..."
                          value={answers[currentQ.id]?.justification || ""}
                          onChange={(e) => handleJustification(currentQ.id, e.target.value)}
                          className="min-h-[100px]"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Navigation */}
                <div className="flex justify-between pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={goToPrevious}
                    disabled={currentQuestion === 0}
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Précédent
                  </Button>
                  {currentQuestion < questions.length - 1 ? (
                    <Button onClick={goToNext}>
                      Suivant
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  ) : (
                    <Button
                      onClick={() => setShowSubmitConfirm(true)}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <Send className="w-4 h-4 mr-1" />
                      Terminer
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Dialog de confirmation */}
      <Dialog open={showSubmitConfirm} onOpenChange={setShowSubmitConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmer la soumission</DialogTitle>
            <DialogDescription>
              Vous avez répondu à {answeredCount} question{answeredCount > 1 ? "s" : ""} sur {questions.length}.
              {answeredCount < questions.length && (
                <span className="text-amber-600 font-medium block mt-2">
                  Attention : certaines questions n'ont pas de réponse !
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setShowSubmitConfirm(false)}>
              Continuer l'évaluation
            </Button>
            <Button onClick={() => handleSubmit(false)} className="bg-green-600 hover:bg-green-700">
              Confirmer et soumettre
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
