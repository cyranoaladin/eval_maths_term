# PLAN.md — eval_maths_term : Go-Live

> Auteur : Cascade (ingénieur senior full-stack)  
> Superviseur : Alaeddine Ben Rhouma (Shark), prof. agrégé de mathématiques  
> Dernière mise à jour : Phase 1 ✅ — Phase 2 ✅ — Phase 3 en cours

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

## Phase 2 — Moteur de correction mathématique ✅ (branche `phase-2-grading`, tag `v0.2.0-grading`)

Toutes les tâches complétées : comparateurs purs, LLM client Moonshot/Kimi, 20 questions LaTeX, rubrics pédagogiques, composants MathLatex/MathInput/MathPalette, 201 tests verts. Mergé dans `main` avec tag `v0.2.0-grading`.

---

## Phase 3 — Anti-triche professionnel (branche `phase-3-anticheat`, tag `v0.3.0-anticheat`)

### Bloc A : Fondations
| # | Tâche | Statut |
|---|---|---|
| A.1 | `vitest.setup.ts` racine + `setupFiles` dans `vitest.config.ts` ; suppression des `vi.stubEnv` manuels | ⬜ |
| A.2 | Migration BDD `0003_anticheat.sql` : métadonnées sessions, table `answer_drafts`, enum `cheat_events` étendu | ⬜ |
| A.3 | Dépendance `idb-keyval@^6.2.2` | ⬜ |
| A.4 | `db/schema.ts` : champs Phase 3 (ipAddress, fingerprintHash, suspicionScore, suspicionVerdict, answerDrafts) | ⬜ |

### Bloc B : Modules anticheat purs
| # | Tâche | Statut |
|---|---|---|
| B.1 | `api/anticheat/fingerprint.ts` + `contracts/fingerprint-canonical.ts` + tests | ⬜ |
| B.2 | `api/anticheat/score-suspicion.ts` + `contracts/anticheat-config.ts` + tests | ⬜ |
| B.3 | `api/anticheat/event-aggregator.ts` (coalescing 500 ms) + tests | ⬜ |

### Bloc C : Heartbeat + idle sweeper + auto-submit
| # | Tâche | Statut |
|---|---|---|
| C.1 | `api/anticheat/heartbeat.ts` (refresh lastHeartbeatAt, détection mismatch) + tests | ⬜ |
| C.2 | `api/anticheat/auto-submit.ts` (drafts → responses, skipLLM, suspicion finale) + tests | ⬜ |
| C.3 | `api/anticheat/idle-sweeper.ts` (scan stale 180 s, déclenche auto-submit) + tests | ⬜ |
| C.4 | Patch `api/grading/grade-response.ts` : ajout paramètre `skipLLM` | ⬜ |

### Bloc D : Routers
| # | Tâche | Statut |
|---|---|---|
| D.1 | Patch `session-router.ts` : mutation `heartbeat` + ingestion fingerprint au démarrage | ⬜ |
| D.2 | Patch `answer-router.ts` : mutation `saveDraft` + query `listDrafts` | ⬜ |
| D.3 | Patch `cheat-router.ts` : mutation `reportBatch` (déprécier `reportOne`) | ⬜ |
| D.4 | Nouveau `api/routers/teacher-live-router.ts` (query `snapshot`, polling 5 s) | ⬜ |
| D.5 | Intégration `idle-sweeper` dans heartbeat + snapshot | ⬜ |

### Bloc E : Hooks frontend
| # | Tâche | Statut |
|---|---|---|
| E.1 | `src/lib/idb-queue.ts` (wrapper idb-keyval FIFO) | ⬜ |
| E.2 | `src/hooks/useFingerprint.ts` (canvas hash, WebGL, crypto.subtle) | ⬜ |
| E.3 | `src/hooks/useHeartbeat.ts` (poll 15 s, cancelRef, remainingMs) | ⬜ |
| E.4 | `src/hooks/useCheatBuffer.ts` (coalescing + flush 5 s) | ⬜ |
| E.5 | `src/hooks/useAutoSave.ts` (debounce 2 s + IDB queue retry 5 s) | ⬜ |
| E.6 | Refonte `src/hooks/useAntiCheat.ts` → branche sur `useCheatBuffer` | ⬜ |

### Bloc F : Composants UI
| # | Tâche | Statut |
|---|---|---|
| F.1 | `src/components/anticheat/FullscreenGuard.tsx` | ⬜ |
| F.2 | `src/components/anticheat/AutoSaveIndicator.tsx` | ⬜ |
| F.3 | `src/components/anticheat/HeartbeatStatus.tsx` | ⬜ |
| F.4 | `src/components/anticheat/CheatBanner.tsx` | ⬜ |
| F.5 | `src/components/anticheat/DevToolsDetector.tsx` | ⬜ |
| F.6 | `src/components/teacher/LiveDashboard.tsx` + `LiveSessionRow.tsx` + `SuspicionBadge.tsx` | ⬜ |

### Bloc G : Validation
| # | Tâche | Statut |
|---|---|---|
| G.1 | Coverage `api/anticheat/` ≥ 100 % | ⬜ |
| G.2 | `npm run check && lint && test && build` ✅ | ⬜ |
| G.3 | `CHANGELOG.md` entrée `v0.3.0` + note dépréciation `sessions.cheatEvents` | ⬜ |
| G.4 | PR `phase-3-anticheat → main`, checklist 14 critères | ⬜ |

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
