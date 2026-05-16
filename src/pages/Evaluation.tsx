import { useState, useCallback, useRef, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, Clock, Eye, ChevronLeft, ChevronRight, Send, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc-client";
import { useStudentSession } from "@/providers/StudentSessionContext";
import { useAntiCheat } from "@/hooks/useAntiCheat";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useFingerprint } from "@/hooks/useFingerprint";
import { useTimer } from "@/hooks/useTimer";
import { FullscreenGuard } from "@/components/anticheat/FullscreenGuard";
import { HeartbeatStatus } from "@/components/anticheat/HeartbeatStatus";
import { AutoSaveIndicator } from "@/components/anticheat/AutoSaveIndicator";
import { CheatBanner } from "@/components/anticheat/CheatBanner";
import { DevToolsDetector } from "@/components/anticheat/DevToolsDetector";
import type { CheatEvent } from "@contracts/types";
import { EVALUATION_DURATION } from "@contracts/evaluation-data";

export default function Evaluation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const evaluationId = parseInt(searchParams.get("eval") || "0");

  // Phase 3 : session token en mémoire React (pas localStorage)
  const { setSession, sessionToken, sessionId } = useStudentSession();

  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<number, { answer: string; justification?: string }>>({});
  const [cheatEventCount, setCheatEventCount] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const [warningMessage, setWarningMessage] = useState("");
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isStarted, setIsStarted] = useState(false);

  const answersRef = useRef(answers);
  const handleSubmitRef = useRef<(isTimeout?: boolean) => Promise<void>>(async () => {});
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    answersRef.current = answers;
  });

  // Phase 3 : fingerprint calculé avant le start (Web Crypto)
  const { fingerprintHash, components: fpComponents, ready: fpReady } = useFingerprint();

  // Récupérer les questions (public — pas besoin de token)
  const { data: questions, isLoading } = trpc.evaluation.getQuestions.useQuery(
    { evaluationId },
    { enabled: evaluationId > 0 }
  );

  // Mutation publique pour démarrer la session
  const startSession = trpc.session.start.useMutation();

  // Mutation legacy pour la soumission finale (toujours via session.submit)
  const submitAnswers = trpc.evaluation.submitAnswers.useMutation();
  const updateSession = trpc.evaluation.updateSession.useMutation();

  const sessionIdVal = sessionId ?? 0;

  const { formattedTime, progress, isWarning, isCritical, getTimeSpent } = useTimer({
    durationMinutes: EVALUATION_DURATION,
    onTimeUp: useCallback(() => {
      if (!isSubmitted) handleSubmitRef.current(true);
    }, [isSubmitted]),
    isRunning: isStarted && !isSubmitted,
  });

  // Phase 3 : heartbeat 15s, via client student (header injecté par StudentSessionProvider)
  const { remainingMs, isConnected } = useHeartbeat({
    sessionToken,
    fingerprintHash,
    currentQuestionIndex: currentQuestion,
    enabled: isStarted && !isSubmitted && !!sessionToken,
    onExpired: useCallback(() => {
      if (!isSubmitted) handleSubmitRef.current(true);
    }, [isSubmitted]),
    onFingerprintMismatch: useCallback(() => {
      // Silencieux côté élève — le prof voit dans le dashboard
    }, []),
    onIpMismatch: useCallback(() => {
      // Silencieux côté élève
    }, []),
  });

  // Phase 3 : auto-save brouillons
  const currentQ = questions?.[currentQuestion];
  const { status: autoSaveStatus, saveDraft, pendingCount } = useAutoSave({
    enabled: isStarted && !isSubmitted,
  });

  // Phase 3 : anti-triche avec buffer batch
  const handleCheatDetected = useCallback((event: CheatEvent) => {
    setCheatEventCount((c) => c + 1);

    const labels: Partial<Record<CheatEvent["type"], string>> = {
      tab_switch:      "Changement d'onglet détecté !",
      blur:            "Perte de focus détectée !",
      context_menu:    "Clic droit interdit !",
      copy:            "Copier est interdit !",
      paste:           "Coller est interdit !",
      fullscreen_exit: "Sortie du plein écran détectée !",
      print:           "Impression interdite !",
      devtools_open:   "Outils développeur détectés !",
    };

    setWarningMessage(labels[event.type] ?? "Activité suspecte détectée !");
    setShowWarning(true);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    warningTimerRef.current = setTimeout(() => setShowWarning(false), 5_000);
  }, []);

  const { enterFullscreen, buffer: cheatBuffer } = useAntiCheat({
    enabled: isStarted && !isSubmitted,
    sessionToken,
    onCheatDetected: handleCheatDetected,
    onFullscreenExit: useCallback(() => {
      // FullscreenGuard affiche l'overlay — pas de re-enter automatique
    }, []),
  });

  // Soumettre les réponses
  const handleSubmit = useCallback(async (isTimeout = false) => {
    if (!questions || !sessionIdVal) return;
    setIsSubmitted(true);

    // Flush immédiat du buffer cheat avant soumission
    cheatBuffer.flush();

    const formattedAnswers = questions.map((q) => ({
      questionId: q.id,
      answer: answersRef.current[q.id]?.answer || "",
      justification: answersRef.current[q.id]?.justification,
    }));

    try {
      await submitAnswers.mutateAsync({ sessionId: sessionIdVal, answers: formattedAnswers });
      await updateSession.mutateAsync({
        sessionId: sessionIdVal,
        status: isTimeout ? "timed_out" : cheatEventCount > 5 ? "cheating_detected" : "completed",
        timeSpent: getTimeSpent(),
      });
      navigate(`/results?session=${sessionIdVal}`);
    } catch (err) {
      console.error("Error submitting:", err);
    }
  }, [questions, sessionIdVal, submitAnswers, updateSession, getTimeSpent, navigate, cheatEventCount, cheatBuffer]);

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  });

  // Démarrer l'évaluation : calcul fingerprint → session.start → token en mémoire
  const handleStart = async () => {
    if (!evaluationId) return;
    try {
      await enterFullscreen();
      const result = await startSession.mutateAsync({
        evaluationId,
        studentName: searchParams.get("name") ?? "Élève",
        studentEmail: searchParams.get("email") ?? undefined,
        fingerprintComponents: fpComponents ?? undefined,
      });
      setSession(result.sessionToken, result.sessionId);
      setIsStarted(true);
    } catch (err) {
      console.error("Erreur au démarrage de session :", err);
    }
  };

  const handleAnswer = (questionId: number, answer: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], answer } }));
    if (currentQ && isStarted && !isSubmitted) {
      saveDraft({ questionId, answer, justification: answers[questionId]?.justification });
    }
  };

  const handleJustification = (questionId: number, justification: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], justification } }));
    if (currentQ && isStarted && !isSubmitted) {
      saveDraft({ questionId, answer: answers[questionId]?.answer ?? "", justification });
    }
  };

  const goToNext = () => {
    if (questions && currentQuestion < questions.length - 1) setCurrentQuestion((p) => p + 1);
  };
  const goToPrevious = () => {
    if (currentQuestion > 0) setCurrentQuestion((p) => p - 1);
  };

  // ── Spinner fingerprint ──
  if (!fpReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-slate-600">
        <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
        <p className="text-sm">Préparation de la session…</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
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

  const answeredCount = Object.keys(answers).filter((k) => answers[parseInt(k)]?.answer !== "").length;

  // ── Écran de démarrage ──
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
            <Button onClick={handleStart} className="w-full" size="lg" disabled={startSession.isPending}>
              {startSession.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Démarrage…</>
              ) : "Démarrer l'évaluation"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!currentQ) return null;

  // ── Session active ──
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Phase 3 : composants invisibles de surveillance */}
      <DevToolsDetector
        enabled={isStarted && !isSubmitted}
        onDetected={() => cheatBuffer.track("devtools_open")}
      />
      <FullscreenGuard
        enabled={isStarted && !isSubmitted}
        onExit={() => cheatBuffer.track("fullscreen_exit")}
      />
      <CheatBanner
        message={warningMessage}
        visible={showWarning}
        onDismiss={() => setShowWarning(false)}
      />

      {/* Barre supérieure */}
      <div className={`sticky top-0 z-30 border-b ${
        isCritical ? "bg-red-600 text-white" : isWarning ? "bg-amber-500 text-white" : "bg-white"
      } shadow-sm transition-colors duration-300`}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Badge variant={isCritical ? "destructive" : "secondary"} className="text-lg px-3 py-1">
              <Clock className="w-4 h-4 mr-2" />
              {formattedTime}
            </Badge>
            <span className={`text-sm font-medium ${isCritical ? "text-white" : "text-slate-600"}`}>
              Question {currentQuestion + 1} / {questions.length}
            </span>
            {/* Phase 3 : heartbeat status */}
            <HeartbeatStatus isConnected={isConnected} remainingMs={remainingMs} />
          </div>
          <div className="flex items-center gap-4">
            <span className={`text-sm ${isCritical ? "text-white" : "text-slate-500"}`}>
              {answeredCount}/{questions.length} répondues
            </span>
            {cheatEventCount > 0 && (
              <Badge variant="destructive" className="animate-pulse">
                <AlertTriangle className="w-3 h-3 mr-1" />
                {cheatEventCount} alerte{cheatEventCount > 1 ? "s" : ""}
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
                  <div className="flex items-center gap-3">
                    {/* Phase 3 : indicateur auto-save */}
                    <AutoSaveIndicator status={autoSaveStatus} pendingCount={pendingCount} />
                    <Badge variant="secondary" className="text-xs">
                      {currentQ.points} point{currentQ.points > 1 ? "s" : ""}
                    </Badge>
                  </div>
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
                      {(currentQ.options as string[]).map((option: string, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-slate-50 transition-colors cursor-pointer"
                          onClick={() => handleAnswer(currentQ.id, String(idx))}
                        >
                          <RadioGroupItem value={String(idx)} id={`q-${currentQ.id}-opt-${idx}`} />
                          <Label htmlFor={`q-${currentQ.id}-opt-${idx}`} className="cursor-pointer flex-1">
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
                          <Label htmlFor={`q-${currentQ.id}-true`} className="cursor-pointer font-medium">Vrai</Label>
                        </div>
                        <div
                          className="flex items-center space-x-2 p-4 rounded-lg border hover:bg-slate-50 cursor-pointer"
                          onClick={() => handleAnswer(currentQ.id, "false")}
                        >
                          <RadioGroupItem value="false" id={`q-${currentQ.id}-false`} />
                          <Label htmlFor={`q-${currentQ.id}-false`} className="cursor-pointer font-medium">Faux</Label>
                        </div>
                      </div>
                    </RadioGroup>

                    {currentQ.justificationRequired && (
                      <div className="space-y-2">
                        <Label htmlFor={`justif-${currentQ.id}`}>Justification (obligatoire) :</Label>
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
                  <Button variant="outline" onClick={goToPrevious} disabled={currentQuestion === 0}>
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Précédent
                  </Button>
                  {currentQuestion < questions.length - 1 ? (
                    <Button onClick={goToNext}>
                      Suivant
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  ) : (
                    <Button onClick={() => setShowSubmitConfirm(true)} className="bg-green-600 hover:bg-green-700">
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
