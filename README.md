# Plateforme d'Évaluation Interactive

Application full-stack pour créer, passer et noter des évaluations QCM, réponses courtes et vrai/faux.

## Stack

- **Frontend** : React, Vite, TypeScript, Tailwind CSS, shadcn/ui, tRPC
- **Backend** : Hono, tRPC, Drizzle ORM, MySQL
- **Auth** : OAuth via Kimi

## Scripts

- `npm run dev` — démarrer le serveur de développement
- `npm run build` — build production
- `npm run check` — vérifier TypeScript (`tsc -b`)
- `npm run lint` — linter ESLint
- `npm run db:generate` — générer les migrations Drizzle
- `npm run db:migrate` — appliquer les migrations
- `npm run db:push` — synchroniser le schéma avec la DB

## Structure

- `src/` — frontend (pages, composants, hooks)
- `api/` — backend (routers tRPC, middleware, lib)
- `db/` — schéma Drizzle et relations
- `contracts/` — constantes et types partagés

## Fonctionnalités

- Passage d'évaluations avec timer et mode plein écran
- Détection anti-triche (changement d'onglet, copier-coller)
- Dashboard enseignant avec visualisation des résultats
- Correction automatique (QCM, vrai/faux) et assistée par LLM
- Authentification des enseignants via OAuth Kimi
