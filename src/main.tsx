import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { config as configurerZod } from 'zod/v4/core'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import App from './App.tsx'

/*
  Zod compile ses schémas avec `new Function` quand il le peut, et découvre s'il
  le peut en essayant — dans un `try`. La politique de contenu de production
  interdit l'évaluation dynamique : l'essai échoue, Zod bascule sans dommage sur
  son chemin interprété, mais le navigateur signale la violation avant que le
  `catch` n'intervienne. Une erreur dans la console de chaque élève, à chaque
  chargement, pour un comportement pourtant correct.

  On le lui dit donc à l'avance, plutôt que de le lui faire découvrir par
  exception. Le serveur, lui, garde la compilation : sa politique ne s'applique
  qu'au navigateur.
*/
configurerZod({ jitless: true })

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <TRPCProvider>
      <App />
    </TRPCProvider>
  </BrowserRouter>,
)
