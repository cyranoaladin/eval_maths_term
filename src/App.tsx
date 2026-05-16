import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import NotFound from "./pages/NotFound"
import Evaluation from "./pages/Evaluation"
import Results from "./pages/Results"
import Dashboard from "./pages/Dashboard"
import Preview from "./pages/Preview"
import Login from "./pages/Login"
import AuthLayout from "./components/AuthLayout"

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/evaluation" element={<Evaluation />} />
      <Route path="/results" element={<Results />} />
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<AuthLayout><Dashboard /></AuthLayout>} />
      <Route path="/preview" element={<AuthLayout><Preview /></AuthLayout>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
