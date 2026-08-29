# Atelier QCM — Évaluation Mathématiques

Application d'établissement pour **rédiger** des QCM, les **imprimer**, saisir
les copies papier et **noter**. Une même évaluation peut aussi être passée en
ligne, avec surveillance ; les deux supports sont corrigés par le même moteur,
donc une copie vaut la même note quel que soit son parcours.

## Le parcours

1. **Rédiger** — éditeur avec aperçu LaTeX en direct. Chaque distracteur d'un
   QCM porte le diagnostic de l'erreur type qu'il traduit ; l'élève le lit à la
   correction au lieu d'un « Réponse incorrecte » qui ne lui apprend rien.
2. **Faire proposer** — un modèle rédige des questions sur un thème donné, en
   s'appuyant si besoin sur vos supports de cours. Rien n'entre en base sans
   votre relecture.
3. **Imprimer** — `auto-multiple-choice` produit sujet, corrigé et une
   feuille-réponses nominative par élève.
4. **Saisir** — grille au clavier : une lettre par question, la ligne suivante
   s'active seule. Les questions rédigées se notent à la main.
5. **Noter** — notes sur 20, moyenne de classe, export CSV.

## Stack

React 19 + Vite + Tailwind + shadcn/ui · tRPC 11 + Hono · Drizzle ORM + MySQL 8
· KaTeX et MathLive · OAuth Kimi · LLM compatible OpenAI (OpenRouter par défaut)

## Démarrer en local

```bash
npm install
docker compose -f docker-compose.dev.yml up -d      # MySQL sur 127.0.0.1:3307
cp .env.example .env                                 # puis renseigner les secrets
npm run db:migrate
npx tsx db/seed.ts                                   # évaluation de démonstration
npm run dev                                          # http://localhost:3000
```

L'OAuth Kimi n'est pas disponible hors production. Pour atteindre les écrans
enseignant en local :

```bash
npx tsx scripts/dev-session.ts
```

Le script affiche une ligne à coller dans la console du navigateur. Il exige
`TEACHER_SESSION_SECRET`, qu'aucune route ne délivre, et refuse de s'exécuter
en production.

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run check` | Vérification des types |
| `npm run lint` | Style |
| `npm test` | Tests unitaires (384) |
| `npm run build` | Build de production |
| `npm run db:migrate` | Appliquer les migrations |
| `npx tsx db/seed.ts` | Semer l'évaluation de référence |

### Vérifications de bout en bout

Contre une instance démarrée, avec une session enseignant :

```bash
npx tsx scripts/smoke-parcours-eleve.ts                  # parcours élève en ligne
npx tsx scripts/smoke-atelier-enseignant.ts              # rédaction et cohérence
npx tsx scripts/smoke-chaine-papier.ts "$COOKIE"         # rédiger → imprimer → saisir → noter
```

Ils touchent la base et le moteur de correction réels : c'est là qu'apparaissent
les défauts que les tests unitaires ne voient pas.

## Structure

```
api/
  authoring/   génération assistée de questions
  grading/     moteur de correction — source unique, papier comme en ligne
  anticheat/   empreinte, heartbeat, score de suspicion (mode en ligne)
  paper/       gabarit LaTeX AMC, exécution, saisie manuelle
  llm/         transport partagé vers l'API de complétion
  rag/         port de recherche documentaire
  routers/     surface tRPC
contracts/     types et règles partagés client / serveur
db/            schéma Drizzle et migrations
src/           interface React
scripts/       vérifications de bout en bout et outils de développement
```

## Points de conception

**Le barème est la seule source de vérité.** Une question porte deux
descriptions de sa bonne réponse — la colonne `correctAnswer` et
`gradingRubric.mode` — et seule la seconde est consultée par le correcteur.
L'éditeur dérive la première de la seconde, et l'écriture d'une question
incohérente est refusée.

**Les sujets papier ne sont pas mélangés.** Avec mélange, ni le numéro de
question ni la lettre ne désignent la même chose d'une copie à l'autre, et la
saisie manuelle devient ininterprétable. La contrepartie est assumée : pas
d'anti-copiage par permutation.

**Le LLM et le RAG sont facultatifs.** Sans clé, la rédaction reste manuelle et
les réponses ouvertes sont marquées à corriger. Sans RAG, la génération perd
son ancrage documentaire, pas sa disponibilité.

## Documentation

- [`PLAN.md`](PLAN.md) — feuille de route et critères de mise en service
- [`CHANGELOG.md`](CHANGELOG.md) — historique détaillé par phase
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — mise en production
- [`SECURITY.md`](SECURITY.md) — modèle de menaces et données personnelles
