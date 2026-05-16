import { useState } from "react";
import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  LayoutDashboard,
  Users,
  TrendingUp,
  AlertTriangle,
  Search,
  Eye,
  Clock,
  Home,
  ChevronDown,
  ChevronUp,
  Radio,
} from "lucide-react";
import { trpc } from "@/providers/trpc-client";
import { LiveDashboard } from "@/components/teacher/LiveDashboard";

const COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444"];

export default function Dashboard() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [liveOpen, setLiveOpen] = useState(true);

  const { data: evaluationList } = trpc.evaluation.list.useQuery();
  const activeEvaluationId = evaluationList?.[0]?.id ?? null;

  const { data: sessions, isLoading } = trpc.evaluation.getAllSessions.useQuery();
  const { data: sessionDetails } = trpc.evaluation.getSessionDetails.useQuery(
    { sessionId: selectedSession || 0 },
    { enabled: selectedSession !== null }
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const filteredSessions = sessions?.filter((s) =>
    s.studentName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Statistiques
  const totalSessions = sessions?.length || 0;
  const completedSessions = sessions?.filter((s) => s.status === "completed").length || 0;
  const cheatingDetected = sessions?.filter((s) => s.status === "cheating_detected").length || 0;
  const timedOut = sessions?.filter((s) => s.status === "timed_out").length || 0;

  const averageScore =
    sessions && sessions.length > 0
      ? Math.round(
          sessions.reduce((sum, s) => sum + (s.totalScore || 0), 0) / sessions.length
        )
      : 0;

  const maxScore = sessions && sessions.length > 0
    ? Math.max(...sessions.map((s) => s.maxScore || 1))
    : 1;

  // Données pour le graphique
  const scoreDistribution = [
    { range: "0-25%", count: sessions?.filter((s) => ((s.totalScore || 0) / (s.maxScore || 1)) * 100 <= 25).length || 0 },
    { range: "25-50%", count: sessions?.filter((s) => {
      const pct = ((s.totalScore || 0) / (s.maxScore || 1)) * 100;
      return pct > 25 && pct <= 50;
    }).length || 0 },
    { range: "50-75%", count: sessions?.filter((s) => {
      const pct = ((s.totalScore || 0) / (s.maxScore || 1)) * 100;
      return pct > 50 && pct <= 75;
    }).length || 0 },
    { range: "75-100%", count: sessions?.filter((s) => ((s.totalScore || 0) / (s.maxScore || 1)) * 100 > 75).length || 0 },
  ];

  const statusData = [
    { name: "Terminé", value: completedSessions },
    { name: "Triche", value: cheatingDetected },
    { name: "Temps écoulé", value: timedOut },
    { name: "En cours", value: totalSessions - completedSessions - cheatingDetected - timedOut },
  ].filter((d) => d.value > 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-100 text-green-800">Terminé</Badge>;
      case "cheating_detected":
        return <Badge variant="destructive">Triche</Badge>;
      case "timed_out":
        return <Badge variant="secondary">Temps écoulé</Badge>;
      default:
        return <Badge variant="outline">En cours</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LayoutDashboard className="w-6 h-6 text-blue-600" />
            <h1 className="text-xl font-bold">Tableau de bord — Professeur</h1>
          </div>
          <Link to="/">
            <Button variant="outline" size="sm">
              <Home className="w-4 h-4 mr-2" />
              Accueil
            </Button>
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Phase 3 : Live dashboard prof */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio className="h-5 w-5 text-red-500 animate-pulse" aria-hidden="true" />
                <CardTitle className="text-base">Surveillance en direct</CardTitle>
                {activeEvaluationId && (
                  <Badge variant="outline" className="text-xs">
                    Éval #{activeEvaluationId}
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLiveOpen((o) => !o)}
                aria-expanded={liveOpen}
                aria-label={liveOpen ? "Réduire la surveillance" : "Afficher la surveillance"}
              >
                {liveOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
          </CardHeader>
          {liveOpen && (
            <CardContent>
              {activeEvaluationId ? (
                <LiveDashboard evaluationId={activeEvaluationId} />
              ) : (
                <p className="text-sm text-gray-400 py-4 text-center">
                  Aucune évaluation active. Le suivi en direct apparaîtra ici dès qu'une session démarre.
                </p>
              )}
            </CardContent>
          )}
        </Card>

        {/* Stats Cards */}
        <div className="grid md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Total élèves</p>
                <p className="text-2xl font-bold">{totalSessions}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-green-100 rounded-lg">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Moyenne classe</p>
                <p className="text-2xl font-bold">{averageScore}/{maxScore}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-red-100 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Triche détectée</p>
                <p className="text-2xl font-bold">{cheatingDetected}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-amber-100 rounded-lg">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Temps écoulé</p>
                <p className="text-2xl font-bold">{timedOut}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Graphiques */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Distribution des scores</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={scoreDistribution}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="range" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Statut des sessions</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    label
                  >
                    {statusData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Table des sessions */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Résultats par élève</CardTitle>
                <CardDescription>Cliquez sur un élève pour voir le détail</CardDescription>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Rechercher un élève..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Temps</TableHead>
                  <TableHead>Alertes</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSessions?.map((s) => {
                  const percentage = Math.round(((s.totalScore || 0) / (s.maxScore || 1)) * 100);
                  const minutes = Math.floor((s.timeSpent || 0) / 60);
                  const seconds = (s.timeSpent || 0) % 60;

                  return (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => setSelectedSession(s.id)}
                    >
                      <TableCell className="font-medium">{s.studentName}</TableCell>
                      <TableCell>{s.studentEmail || "—"}</TableCell>
                      <TableCell>
                        {s.startedAt ? new Date(s.startedAt).toLocaleDateString("fr-FR") : "—"}
                      </TableCell>
                      <TableCell>{getStatusBadge(s.status)}</TableCell>
                      <TableCell>
                        <span
                          className={`font-bold ${percentage >= 50 ? "text-green-600" : "text-red-600"}`}
                        >
                          {s.totalScore || 0}/{s.maxScore || 0}
                        </span>
                        <span className="text-xs text-slate-500 ml-1">({percentage}%)</span>
                      </TableCell>
                      <TableCell>
                        {minutes}m {seconds}s
                      </TableCell>
                      <TableCell>
                        {s.tabSwitchCount > 0 ? (
                          <Badge variant="destructive" className="text-xs">
                            {s.tabSwitchCount}
                          </Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedSession(s.id)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Modal de détail */}
        {selectedSession && sessionDetails && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <Card className="max-w-2xl w-full max-h-[90vh] overflow-auto">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Détail — {sessionDetails.session.studentName}</CardTitle>
                    <CardDescription>
                      Score : {sessionDetails.session.totalScore}/{sessionDetails.session.maxScore}
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedSession(null)}>
                    ✕
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {sessionDetails.responses.map((resp: { id: number; answer: string; justification: string | null; isCorrect: boolean | null; score: number | null; maxScore: number | null; llmFeedback: string | null; question?: { question: string; correctAnswer: string; type: string } }, idx: number) => (
                  <div
                    key={resp.id}
                    className={`p-4 rounded-lg border ${
                      resp.isCorrect ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
                    }`}
                  >
                    <p className="font-medium text-sm mb-2">
                      Question {idx + 1} : {resp.question?.question}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Réponse élève :</span> {resp.answer || "Non répondu"}
                    </p>
                    {resp.justification && (
                      <p className="text-sm">
                        <span className="font-medium">Justification :</span> {resp.justification}
                      </p>
                    )}
                    <p className="text-sm">
                      <span className="font-medium">Réponse attendue :</span>{" "}
                      {resp.question?.correctAnswer}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span
                        className={`text-sm font-bold ${resp.isCorrect ? "text-green-700" : "text-red-700"}`}
                      >
                        {resp.score}/{resp.maxScore}
                      </span>
                      {resp.llmFeedback && (
                        <span className="text-xs text-slate-500 italic">{resp.llmFeedback}</span>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
