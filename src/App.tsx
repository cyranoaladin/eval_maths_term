import { Routes, Route } from 'react-router'
import { Suspense, lazy } from 'react'
import Home from './pages/Home'
import NotFound from "./pages/NotFound"
import Login from "./pages/Login"
import AuthLayout from "./components/AuthLayout"
import { StudentSessionProvider } from "./providers/StudentSessionContext"

/**
 * Découpage par route.
 *
 * Un élève qui compose n'a besoin ni de l'atelier de rédaction, ni des
 * graphiques du tableau de bord ; l'enseignant qui rédige n'a pas besoin du
 * moteur de saisie mathématique de la page d'évaluation. Tout charger d'un
 * bloc imposait 1,75 Mo à chacun — un poids qui se paie sur une connexion
 * d'établissement, au pire moment : au démarrage d'une épreuve.
 */
const Evaluation = lazy(() => import("./pages/Evaluation"))
const Results = lazy(() => import("./pages/Results"))
const Dashboard = lazy(() => import("./pages/Dashboard"))
const Preview = lazy(() => import("./pages/Preview"))
const Evaluations = lazy(() => import("./pages/teacher/Evaluations"))
const EvaluationEditor = lazy(() => import("./pages/teacher/EvaluationEditor"))
const PaperEntry = lazy(() => import("./pages/teacher/PaperEntry"))
const Correction = lazy(() => import("./pages/teacher/Correction"))
const Comptes = lazy(() => import("./pages/admin/Comptes"))
const MentionsLegales = lazy(() => import("./pages/legal/MentionsLegales"))
const Confidentialite = lazy(() => import("./pages/legal/Confidentialite"))

function Chargement() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      <span className="sr-only">Chargement…</span>
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<Chargement />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/evaluation" element={<StudentSessionProvider><Evaluation /></StudentSessionProvider>} />
        <Route path="/results" element={<Results />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<AuthLayout><Dashboard /></AuthLayout>} />
        <Route path="/preview" element={<AuthLayout><Preview /></AuthLayout>} />
        <Route path="/teacher/evaluations" element={<AuthLayout><Evaluations /></AuthLayout>} />
        <Route path="/teacher/evaluations/:id" element={<AuthLayout><EvaluationEditor /></AuthLayout>} />
        <Route path="/teacher/saisie/:examId" element={<AuthLayout><PaperEntry /></AuthLayout>} />
        <Route path="/teacher/correction/:examId" element={<AuthLayout><Correction /></AuthLayout>} />
        <Route path="/admin/comptes" element={<AuthLayout><Comptes /></AuthLayout>} />
        <Route path="/mentions-legales" element={<MentionsLegales />} />
        <Route path="/confidentialite" element={<Confidentialite />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
