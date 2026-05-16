import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Eye,
  CheckCircle,
  XCircle,
  Play,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
} from "lucide-react";
import {
  evaluationQuestions,
  EVALUATION_DESCRIPTION,
  EVALUATION_DURATION,
  MAX_SCORE,
} from "@contracts/evaluation-data";

export default function Preview() {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [showAnswers, setShowAnswers] = useState(false);

  const currentQ = evaluationQuestions[currentQuestion];

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "qcm": return "QCM";
      case "short_answer": return "Réponse courte";
      case "true_false": return "Vrai / Faux";
      default: return type;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "qcm": return "bg-blue-100 text-blue-800";
      case "short_answer": return "bg-green-100 text-green-800";
      case "true_false": return "bg-purple-100 text-purple-800";
      default: return "bg-slate-100";
    }
  };

  const getCorrectAnswerText = (q: typeof currentQ) => {
    if (q.type === "qcm" && q.options) {
      return q.options[parseInt(q.correctAnswer)] || q.correctAnswer;
    }
    if (q.type === "true_false") {
      return q.correctAnswer === "true" ? "Vrai" : "Faux";
    }
    return q.correctAnswer;
  };

  const goToNext = () => {
    if (currentQuestion < evaluationQuestions.length - 1) {
      setCurrentQuestion((prev) => prev + 1);
    }
  };

  const goToPrevious = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion((prev) => prev - 1);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Eye className="w-6 h-6 text-blue-600" />
            <div>
              <h1 className="text-lg font-bold">Aperçu de l'évaluation</h1>
              <p className="text-xs text-slate-500">Vue enseignant — {evaluationQuestions.length} questions</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg text-sm">
              <HelpCircle className="w-4 h-4 text-slate-500" />
              <span className="text-slate-600">Durée : {EVALUATION_DURATION} min</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 rounded-lg text-sm">
              <CheckCircle className="w-4 h-4 text-blue-600" />
              <span className="text-blue-700 font-medium">{MAX_SCORE} points</span>
            </div>
            <Link to="/">
              <Button variant="outline" size="sm">
                <Play className="w-4 h-4 mr-1" />
                Lancer
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Sidebar - Liste des questions */}
          <div className="lg:col-span-1">
            <Card className="sticky top-24">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Questions ({evaluationQuestions.length})</CardTitle>
                <CardDescription className="text-xs">
                  Cliquez pour naviguer
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-[60vh] overflow-y-auto">
                  {evaluationQuestions.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentQuestion(idx)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2 ${
                        idx === currentQuestion
                          ? "bg-blue-100 text-blue-800 ring-1 ring-blue-300"
                          : "hover:bg-slate-50 text-slate-600"
                      }`}
                    >
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                        idx === currentQuestion ? "bg-blue-600 text-white" : "bg-slate-200"
                      }`}>
                        {idx + 1}
                      </span>
                      <span className="truncate flex-1">{getTypeLabel(q.type)}</span>
                      <span className="text-xs text-slate-400">{q.points}pt</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main - Question courante */}
          <div className="lg:col-span-2 space-y-4">
            {/* Résumé */}
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-4">
                <h2 className="font-bold text-blue-900">Évaluation de Mathématiques — Terminale EDS</h2>
                <p className="text-sm text-blue-700 mt-1">{EVALUATION_DESCRIPTION}</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Badge variant="outline" className="bg-white">
                    {evaluationQuestions.filter((q) => q.type === "qcm").length} QCM
                  </Badge>
                  <Badge variant="outline" className="bg-white">
                    {evaluationQuestions.filter((q) => q.type === "short_answer").length} Réponses courtes
                  </Badge>
                  <Badge variant="outline" className="bg-white">
                    {evaluationQuestions.filter((q) => q.type === "true_false").length} Vrai/Faux
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Question card */}
            <Card className="shadow-lg">
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Badge className={getTypeColor(currentQ.type)}>
                      {getTypeLabel(currentQ.type)}
                    </Badge>
                    <Badge variant="secondary">
                      {currentQ.points} point{currentQ.points > 1 ? "s" : ""}
                    </Badge>
                    {currentQ.justificationRequired && (
                      <Badge variant="outline" className="bg-amber-50 text-amber-700">
                        Justification requise
                      </Badge>
                    )}
                  </div>
                  <span className="text-sm text-slate-400">
                    Question {currentQuestion + 1} / {evaluationQuestions.length}
                  </span>
                </div>
                <CardTitle className="text-lg mt-3 leading-relaxed">
                  {currentQ.question}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* QCM Preview */}
                {currentQ.type === "qcm" && currentQ.options && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-500 mb-2">Options :</p>
                    <RadioGroup disabled>
                      <div className="space-y-2">
                        {currentQ.options.map((option, idx) => (
                          <div
                            key={idx}
                            className={`flex items-center space-x-3 p-3 rounded-lg border ${
                              showAnswers && String(idx) === currentQ.correctAnswer
                                ? "bg-green-50 border-green-300"
                                : "bg-slate-50"
                            }`}
                          >
                            <RadioGroupItem value={String(idx)} id={`preview-opt-${idx}`} />
                            <Label htmlFor={`preview-opt-${idx}`} className="flex-1 cursor-pointer">
                              {option}
                            </Label>
                            {showAnswers && String(idx) === currentQ.correctAnswer && (
                              <CheckCircle className="w-5 h-5 text-green-600" />
                            )}
                          </div>
                        ))}
                      </div>
                    </RadioGroup>
                  </div>
                )}

                {/* Réponse courte Preview */}
                {currentQ.type === "short_answer" && (
                  <div className="space-y-2">
                    <Label>Champ de réponse de l'élève :</Label>
                    <Textarea
                      disabled
                      placeholder="L'élève écrira sa réponse ici..."
                      className="min-h-[80px] bg-slate-50"
                    />
                  </div>
                )}

                {/* Vrai/Faux Preview */}
                {currentQ.type === "true_false" && (
                  <div className="space-y-4">
                    <RadioGroup disabled>
                      <div className="flex gap-4">
                        <div className={`flex items-center space-x-2 p-4 rounded-lg border ${
                          showAnswers && currentQ.correctAnswer === "true" ? "bg-green-50 border-green-300" : "bg-slate-50"
                        }`}>
                          <RadioGroupItem value="true" id="preview-true" />
                          <Label htmlFor="preview-true" className="font-medium">Vrai</Label>
                          {showAnswers && currentQ.correctAnswer === "true" && (
                            <CheckCircle className="w-5 h-5 text-green-600 ml-2" />
                          )}
                        </div>
                        <div className={`flex items-center space-x-2 p-4 rounded-lg border ${
                          showAnswers && currentQ.correctAnswer === "false" ? "bg-green-50 border-green-300" : "bg-slate-50"
                        }`}>
                          <RadioGroupItem value="false" id="preview-false" />
                          <Label htmlFor="preview-false" className="font-medium">Faux</Label>
                          {showAnswers && currentQ.correctAnswer === "false" && (
                            <CheckCircle className="w-5 h-5 text-green-600 ml-2" />
                          )}
                        </div>
                      </div>
                    </RadioGroup>
                    {currentQ.justificationRequired && (
                      <div>
                        <Label>Champ de justification :</Label>
                        <Textarea
                          disabled
                          placeholder="L'élève justifiera sa réponse ici..."
                          className="min-h-[80px] bg-slate-50"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Réponse correcte */}
                {showAnswers && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2 text-green-800 font-medium mb-1">
                      <CheckCircle className="w-5 h-5" />
                      Réponse correcte :
                    </div>
                    <p className="text-green-700">{getCorrectAnswerText(currentQ)}</p>
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
                  <Button
                    variant={showAnswers ? "default" : "outline"}
                    onClick={() => setShowAnswers(!showAnswers)}
                  >
                    {showAnswers ? (
                      <>
                        <XCircle className="w-4 h-4 mr-1" />
                        Masquer la réponse
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Voir la réponse
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={goToNext}
                    disabled={currentQuestion === evaluationQuestions.length - 1}
                  >
                    Suivant
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Résumé global */}
            <Card className="bg-slate-50">
              <CardHeader>
                <CardTitle className="text-sm">Répartition des questions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-3 bg-white rounded-lg">
                    <p className="text-2xl font-bold text-blue-600">
                      {evaluationQuestions.filter((q) => q.type === "qcm").length}
                    </p>
                    <p className="text-xs text-slate-500">QCM</p>
                    <p className="text-xs text-slate-400">
                      {evaluationQuestions.filter((q) => q.type === "qcm").reduce((s, q) => s + q.points, 0)} pts
                    </p>
                  </div>
                  <div className="p-3 bg-white rounded-lg">
                    <p className="text-2xl font-bold text-green-600">
                      {evaluationQuestions.filter((q) => q.type === "short_answer").length}
                    </p>
                    <p className="text-xs text-slate-500">Réponses courtes</p>
                    <p className="text-xs text-slate-400">
                      {evaluationQuestions.filter((q) => q.type === "short_answer").reduce((s, q) => s + q.points, 0)} pts
                    </p>
                  </div>
                  <div className="p-3 bg-white rounded-lg">
                    <p className="text-2xl font-bold text-purple-600">
                      {evaluationQuestions.filter((q) => q.type === "true_false").length}
                    </p>
                    <p className="text-xs text-slate-500">Vrai / Faux</p>
                    <p className="text-xs text-slate-400">
                      {evaluationQuestions.filter((q) => q.type === "true_false").reduce((s, q) => s + q.points, 0)} pts
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
