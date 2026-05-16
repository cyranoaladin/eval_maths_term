# PLAN.md — eval_maths_term : Go-Live

> Auteur : Cascade (ingénieur senior full-stack)  
> Superviseur : Alaeddine Ben Rhouma (Shark), prof. agrégé de mathématiques  
> Dernière mise à jour : Phase 1 ✅ — Phase 2 en cours

---

## Phase 1 — Sécurité & intégrité ✅ (branche `phase-1-security`, tag `v0.1.0-security`) [BLOQUANT]

| # | Tâche | Statut |
|---|---|---|
| 1.1 | Purge `correctAnswer` côté client : `contracts/public-types.ts` + `api/routers/question-router.ts` (studentQuery) | ✅ |
| 1.2 | Procédures tRPC typées : `teacherQuery` + migration schéma rôle `user→teacher/student` | ✅ |
| 1.3 | Tokens session élève JWT signés serveur (`api/anticheat/session-token.ts`) | ✅ |
| 1.4 | Timer serveur-autoritatif : `serverTime` + `expiresAt` dans `createSession`, vérif expiration sur toutes les mutations | ✅ |
| 1.5 | Anti-falsification scores : supprimer `totalScore`, `tabSwitchCount`, `cheatEvents` des inputs client | ✅ |
| 1.6 | OAuth state CSRF : `nanoid(32)` + cookie HttpOnly `kimi_oauth_state` | ✅ |
| 1.7 | Cookies & secrets : `maxAge 12h`, `TEACHER_SESSION_SECRET` distinct de `APP_SECRET` | ✅ |
| 1.8 | Vérification Origin / Referer (CSRF tRPC) : `api/lib/csrf.ts` | ✅ |
| 1.9 | Rate limiting : `rate-limiter-flexible` in-memory, limites par route | ✅ |
| 1.10 | FK SQL + index : migration Drizzle `0001_fk_and_indexes.sql` | ✅ |
| 1.11 | Validation Zod des envs : refondre `api/lib/env.ts` | ✅ |
| 1.12 | Logger structuré `api/lib/logger.ts` (wrapper JSON avec niveaux) | ✅ |
| 1.13 | Tests sécurité : 7 fichiers spec (no-leak, session-token, role-access, timer-enforce, cheat-immutability, csrf-origin, rate-limit) | ✅ |
| 1.14 | `CHANGELOG.md` Phase 1 | ✅ |
| 1.15 | Commit + push `phase-1-security` → PR vers `main` | ✅ |

---

## Phase 2 — Moteur de correction mathématique (branche `phase-2-grading`, tag `v0.2.0-grading`)

### Bloc A : Fondations
| # | Tâche | Statut |
|---|---|---|
| A.1 | Ajout dépendances : `mathjs@^13`, `katex@^0.16`, `lru-cache@^11`, `mathlive@^0.105`, `@types/katex` | ⬜ |
| A.2 | Migration BDD `0002_grading_rubric.sql` : `gradingRubric`, `tags`, `difficulty` sur `questions` ; `normalizedScore DECIMAL(5,2)` sur `sessions` ; `gradingMode`, `llmConfidence`, `gradingReason`, `partialCreditApplied` sur `responses` | ⬜ |
| A.3 | `contracts/grading-rubric.ts` : schémas Zod `ComparisonMode`, `GradingRubric`, `PartialCreditRule` + types inférés | ⬜ |

### Bloc B : Comparateurs purs (sans LLM, sans BDD)
| # | Tâche | Statut |
|---|---|---|
| B.1 | `api/grading/normalize.ts` + `normalize.spec.ts` (≥50 cas couvrant toutes les `acceptableForms` des Q11–Q15) | ⬜ |
| B.2 | `api/grading/compare-exact.ts` + tests | ⬜ |
| B.3 | `api/grading/compare-numeric.ts` (tolérance abs/rel) + tests | ⬜ |
| B.4 | `api/grading/compare-fraction.ts` (PGCD, irréductibilité, pénalité 25%) + tests | ⬜ |
| B.5 | `api/grading/compare-symbolic.ts` (3 passes : littéral → simplify → numérique 20 pts) + tests (variantes Q11–Q14) | ⬜ |
| B.6 | `api/grading/compare-set.ts` (ordonné/non-ordonné) + tests | ⬜ |
| B.7 | `api/grading/shuffle.ts` (mulberry32 + Fisher-Yates + shuffleOptions avec mapping inverse) + tests déterminisme + distribution | ⬜ |

### Bloc C : LLM client + orchestrateur
| # | Tâche | Statut |
|---|---|---|
| C.1 | `api/grading/llm-client.ts` : fetch Moonshot/Kimi, retry ×3 backoff exponentiel, cache LRU 1h, parsing tolérant fences JSON | ⬜ |
| C.2 | `api/grading/grading-prompt.ts` : templates système + utilisateur par type (qcm / short_answer / true_false) | ⬜ |
| C.3 | `api/grading/grade-response.ts` : orchestrateur — appel comparateurs purs en cascade, fallback LLM si `llmReviewRequired` | ⬜ |
| C.4 | `grade-response.spec.ts` + `llm-client.spec.ts` : LLM mocké via `vi.mock`, test retry, cache, parsing JSON fences | ⬜ |

### Bloc D : Données & seed
| # | Tâche | Statut |
|---|---|---|
| D.1 | Réécriture LaTeX des 20 énoncés + rubrics + tags + difficulty dans `contracts/evaluation-data.ts` (Q1–Q20 selon §VI du brief) | ⬜ |
| D.2 | Corrections pédagogiques : Q7 (intervalle ouvert `]a;b[`), Q19 (`a < b` explicite), notations décimales FR | ⬜ |
| D.3 | `db/seed.ts` idempotent : `INSERT … ON DUPLICATE KEY UPDATE` pour questions sans casser les sessions existantes | ⬜ |

### Bloc E : Intégration backend
| # | Tâche | Statut |
|---|---|---|
| E.1 | `api/routers/answer-router.ts` : `saveDraft` (studentQuery) + `submit` appelant `gradeResponse` | ⬜ |
| E.2 | `api/routers/grading-router.ts` : `regradeWithLLM` + `manualOverride` (teacherQuery) | ⬜ |
| E.3 | Mise à jour `session-router.ts` : `shuffleSeed` déjà présent, ajouter payload dans studentToken | ⬜ |
| E.4 | Mise à jour `question-router.ts` : `shuffleDeterministic` + `shuffleOptions` avec mapping ; appliquer mapping inverse au submit | ⬜ |
| E.5 | `normalizedScore = round(totalScore/maxScore*20*4)/4` stocké en `DECIMAL(5,2)` au submit | ⬜ |

### Bloc F : Frontend mathématique
| # | Tâche | Statut |
|---|---|---|
| F.1 | `src/components/math/MathLatex.tsx` : rendu KaTeX inline + display, split auto `$…$` / `$$…$$` | ⬜ |
| F.2 | `src/components/math/MathInput.tsx` : MathLive Web Component, import dynamique, ready state | ⬜ |
| F.3 | `src/components/math/MathPalette.tsx` : boutons symboles courants (fractions, racines, exposants) | ⬜ |
| F.4 | Intégration `src/pages/Evaluation.tsx` : énoncés LaTeX via `MathLatex`, saisie RC via `MathInput` | ⬜ |
| F.5 | Intégration `src/pages/Results.tsx` : affichage note /20, réponse attendue en LaTeX | ⬜ |

### Bloc G : Validation & qualité
| # | Tâche | Statut |
|---|---|---|
| G.1 | Coverage `api/grading/` ≥ 100%, globale ≥ 80% | ⬜ |
| G.2 | Tests E2E variantes : ≥5 formes par RC (Q11–Q15) conformes au §VIII critère 5 | ⬜ |
| G.3 | `npm run check && npm run lint && npm test && npm run build` ✅ | ⬜ |
| G.4 | `CHANGELOG.md` entrée `v0.2.0-grading` | ⬜ |
| G.5 | `docs/screenshots/phase-2/` (KaTeX Chromium + Firefox) | ⬜ |
| G.6 | PR `phase-2-grading → main`, description cochant les 11 critères §VIII | ⬜ |
| G.7 | Tag `v0.2.0-grading` après merge | ⬜ |

---

## Phase 3 — Anti-triche professionnel (branche `phase-3-anticheat`)

| # | Tâche | Statut |
|---|---|---|
| 3.1 | `src/hooks/useHeartbeat.ts` : mutation `session.heartbeat` toutes les 15s | ⬜ |
| 3.2 | `src/hooks/useAutoSave.ts` : debounce 2s + IndexedDB offline queue | ⬜ |
| 3.3 | `api/routers/cheat-router.ts` : ingestion batch, append-only, throttlé | ⬜ |
| 3.4 | `api/anticheat/event-aggregator.ts` : dédoublonnage + coalescing | ⬜ |
| 3.5 | `api/anticheat/fingerprint.ts` : hash SHA-256 multi-facteur | ⬜ |
| 3.6 | `api/anticheat/heartbeat.ts` : logique auto-submit à 180s sans heartbeat | ⬜ |
| 3.7 | `api/anticheat/score-suspicion.ts` : score 0–100 + verdict pédagogique | ⬜ |
| 3.8 | Détection DevTools (performance.now + debugger trap) | ⬜ |
| 3.9 | Détection multi-device (IP + fingerprint diff entre heartbeats) | ⬜ |
| 3.10 | Lockdown navigateur : user-select, drag-drop, prefetch | ⬜ |
| 3.11 | UX : bandeau auto-save, pop-up fullscreen, aria-live | ⬜ |
| 3.12 | Tests Phase 3 | ⬜ |
| 3.13 | CHANGELOG.md Phase 3 | ⬜ |

---

## Phase 4 — Dashboard enseignant & multi-évaluations (branche `phase-4-teacher`)

| # | Tâche | Statut |
|---|---|---|
| 4.1 | Migration BDD : tables `classes`, `students`, `evaluation_assignments` | ⬜ |
| 4.2 | Import CSV élèves + génération codes d'accès format `XXXX-XXXX-XXXX` | ⬜ |
| 4.3 | CRUD évaluations (titre, description, durée, questions, rubric) | ⬜ |
| 4.4 | `api/routers/stats-router.ts` : stats par item, discrimination, distribution | ⬜ |
| 4.5 | Page `/teacher/evaluations` (liste + création + édition) | ⬜ |
| 4.6 | Page `/teacher/sessions/:id` (correction manuelle assistée) | ⬜ |
| 4.7 | Page `/teacher/stats` (Recharts : barres, scatter, distribution) | ⬜ |
| 4.8 | Page `/teacher/live/:assignmentId` (surveillance temps réel via SSE) | ⬜ |
| 4.9 | Export CSV + PDF (résultats + bilan élève) | ⬜ |
| 4.10 | Table `audit_log` + `api/routers/admin-router.ts` | ⬜ |
| 4.11 | UI : traduction 100% FR (Login, AuthLayout, NotFound, sidebar) | ⬜ |
| 4.12 | Tests Phase 4 | ⬜ |
| 4.13 | CHANGELOG.md Phase 4 | ⬜ |

---

## Phase 5 — DevOps, qualité, go-live (branche `phase-5-devops`)

| # | Tâche | Statut |
|---|---|---|
| 5.1 | `Dockerfile` multi-stage (builder + runtime node:20-slim) | ⬜ |
| 5.2 | `docker-compose.yml` (mysql 8 + redis 7 + app) | ⬜ |
| 5.3 | `.github/workflows/ci.yml` (lint + typecheck + test + build + security) | ⬜ |
| 5.4 | Route `GET /api/health` (DB check + uptime + version) | ⬜ |
| 5.5 | Logger Pino ou wrapper structuré JSON avec requestId | ⬜ |
| 5.6 | Sentry optionnel (`SENTRY_DSN`) | ⬜ |
| 5.7 | `README.md` réécrit (pitch + quickstart + scripts) | ⬜ |
| 5.8 | `DEPLOYMENT.md` (pré-requis + procédure + reverse proxy + backup) | ⬜ |
| 5.9 | `SECURITY.md` (modèle de menaces + mitigations + signalement) | ⬜ |
| 5.10 | Pages RGPD `/legal` + `/privacy` + export données élève | ⬜ |
| 5.11 | Test de charge k6 (200 élèves concurrents, p95 < 500ms) | ⬜ |
| 5.12 | Bundle splitting Vite (chunk prof séparé) | ⬜ |
| 5.13 | CHANGELOG.md Phase 5 | ⬜ |
| 5.14 | Tag `v1.0.0-rc1` après revue de Shark | ⬜ |

---

## Critères d'acceptation Go-Live (§VIII.4)

- [ ] 1. Aucune route publique ne renvoie `correctAnswer`
- [ ] 2. Chaque mutation élève exige un `sessionToken` valide non expiré
- [ ] 3. Submit impossible après expiration serveur du timer
- [ ] 4. Score, tabSwitchCount, cheatEvents non falsifiables par le client
- [ ] 5. Dashboard prof exige le rôle `teacher`
- [ ] 6. Correction des 5 RC accepte ≥ 5 variantes équivalentes (test paramétré)
- [ ] 7. Rendu LaTeX correct sur Chrome, Firefox, Safari, mobile
- [ ] 8. Saisie MathLive fonctionnelle et exploitable côté serveur
- [ ] 9. Auto-save survit à 30s de coupure réseau
- [ ] 10. Heartbeat détecte déconnexion à 60s, auto-submit à 180s
- [ ] 11. Score de suspicion calculé + affiché au prof avec verdict
- [ ] 12. Coverage ≥ 80% global, ≥ 100% sur `api/grading/`
- [ ] 13. Migrations Drizzle committées dans `db/migrations/`
- [ ] 14. `docker compose up` < 30s
- [ ] 15. CI GitHub Actions verte sur `main`
- [ ] 16. 0 `any`, 0 `// @ts-ignore` non commenté
- [ ] 17. Audit log : 100% des modifications de scores manuels
- [ ] 18. Export CSV et PDF fonctionnel
- [ ] 19. Login + AuthLayout + NotFound en français FR-FR
- [ ] 20. k6 : 200 élèves concurrents, p95 < 500ms, 0 erreur
- [ ] 21. RGPD : mentions légales + confidentialité + export utilisateur
- [ ] 22. SECURITY.md à jour
- [ ] 23. README.md réécrit, quickstart fonctionnel sur machine vierge
