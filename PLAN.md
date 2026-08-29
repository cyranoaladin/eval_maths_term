# PLAN.md — eval_maths_term : Go-Live

> Auteur : Cascade (ingénieur senior full-stack)  
> Superviseur : Alaeddine Ben Rhouma (Shark), prof. agrégé de mathématiques  
> Dernière mise à jour : Phases 1 à 4 ✅ — Phase 5 en cours (reste RGPD, k6, Sentry, tag)

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

## Phase 3 — Anti-triche professionnel ✅ (branche `phase-3-anticheat`, tag `v0.3.0-anticheat`)

### Bloc A : Fondations
| # | Tâche | Statut |
|---|---|---|
| A.1 | `vitest.setup.ts` racine + `setupFiles` dans `vitest.config.ts` ; suppression des `vi.stubEnv` manuels | ✅ |
| A.2 | Migration BDD `0003_anticheat.sql` : métadonnées sessions, table `answer_drafts`, enum `cheat_events` étendu | ✅ |
| A.3 | Dépendance `idb-keyval@^6.2.2` | ✅ |
| A.4 | `db/schema.ts` : champs Phase 3 (ipAddress, fingerprintHash, suspicionScore, suspicionVerdict, answerDrafts) | ✅ |

### Bloc B : Modules anticheat purs
| # | Tâche | Statut |
|---|---|---|
| B.1 | `api/anticheat/fingerprint.ts` + `contracts/fingerprint-canonical.ts` + tests | ✅ |
| B.2 | `api/anticheat/score-suspicion.ts` + `contracts/anticheat-config.ts` + tests | ✅ |
| B.3 | `api/anticheat/event-aggregator.ts` (coalescing 500 ms) + tests | ✅ |

### Bloc C : Heartbeat + idle sweeper + auto-submit
| # | Tâche | Statut |
|---|---|---|
| C.1 | `api/anticheat/heartbeat.ts` (refresh lastHeartbeatAt, détection mismatch) + tests | ✅ |
| C.2 | `api/anticheat/auto-submit.ts` (drafts → responses, skipLLM, suspicion finale) + tests | ✅ |
| C.3 | `api/anticheat/idle-sweeper.ts` (scan stale 180 s, déclenche auto-submit) + tests | ✅ |
| C.4 | Patch `api/grading/grade-response.ts` : ajout paramètre `skipLLM` | ✅ |

### Bloc D : Routers
| # | Tâche | Statut |
|---|---|---|
| D.1 | Patch `session-router.ts` : mutation `heartbeat` + ingestion fingerprint au démarrage | ✅ |
| D.2 | Patch `answer-router.ts` : mutation `saveDraft` + query `listDrafts` | ✅ |
| D.3 | Patch `cheat-router.ts` : mutation `reportBatch` (déprécier `reportOne`) | ✅ |
| D.4 | Nouveau `api/routers/teacher-live-router.ts` (query `snapshot`, polling 5 s) | ✅ |
| D.5 | Intégration `idle-sweeper` dans heartbeat + snapshot | ✅ |

### Bloc E : Hooks frontend
| # | Tâche | Statut |
|---|---|---|
| E.1 | `src/lib/idb-queue.ts` (wrapper idb-keyval FIFO) | ✅ |
| E.2 | `src/hooks/useFingerprint.ts` (canvas hash, WebGL, crypto.subtle) | ✅ |
| E.3 | `src/hooks/useHeartbeat.ts` (poll 15 s, cancelRef, remainingMs) | ✅ |
| E.4 | `src/hooks/useCheatBuffer.ts` (coalescing + flush 5 s) | ✅ |
| E.5 | `src/hooks/useAutoSave.ts` (debounce 2 s + IDB queue retry 5 s) | ✅ |
| E.6 | Refonte `src/hooks/useAntiCheat.ts` → branche sur `useCheatBuffer` | ✅ |

### Bloc F : Composants UI
| # | Tâche | Statut |
|---|---|---|
| F.1 | `src/components/anticheat/FullscreenGuard.tsx` | ✅ |
| F.2 | `src/components/anticheat/AutoSaveIndicator.tsx` | ✅ |
| F.3 | `src/components/anticheat/HeartbeatStatus.tsx` | ✅ |
| F.4 | `src/components/anticheat/CheatBanner.tsx` | ✅ |
| F.5 | `src/components/anticheat/DevToolsDetector.tsx` | ✅ |
| F.6 | `src/components/teacher/LiveDashboard.tsx` + `LiveSessionRow.tsx` + `SuspicionBadge.tsx` | ✅ |

### Bloc G : Validation
| # | Tâche | Statut |
|---|---|---|
| G.1 | Coverage `api/anticheat/` ≥ 100 % | ✅ |
| G.2 | `npm run check && lint && test && build` ✅ | ✅ |
| G.3 | `CHANGELOG.md` entrée `v0.3.0` + note dépréciation `sessions.cheatEvents` | ✅ |
| G.4 | PR `phase-3-anticheat → main`, checklist 14 critères | ✅ |

---

## Phase 3.5 — Convergence front / back ✅ (branche `phase-3.5-convergence`)

Les Phases 1 à 3 avaient durci le backend sans que le frontend élève y soit
rebranché : il appelait encore les routes `publicQuery` de la Phase 0. Aucun
des critères go-live 1 à 4 ne pouvait passer, et le moteur de correction de la
Phase 2 n'était jamais exécuté.

| # | Tâche | Statut |
|---|-------|--------|
| 3.5.1 | Chaîne verte : 2 erreurs TS + 13 erreurs ESLint | ✅ |
| 3.5.2 | `student-trpc.ts` + `student-session.ts` : client élève et porte-jeton hors React | ✅ |
| 3.5.3 | `useHeartbeat` / `useAutoSave` / `useCheatBuffer` basculés sur `studentTrpc` | ✅ |
| 3.5.4 | `grade-session.ts` : moteur de correction partagé (submit / prof / auto-submit) | ✅ |
| 3.5.5 | `optionShuffleSeed` partagée entre affichage et correction | ✅ |
| 3.5.6 | `session.submit` branché sur le moteur Phase 2 + suspicion serveur | ✅ |
| 3.5.7 | `auto-submit` : reconversion de l'index QCM | ✅ |
| 3.5.8 | `Home` / `Evaluation` / `Results` / `Dashboard` sur les routes sûres | ✅ |
| 3.5.9 | Suppression de `api/evaluation-router.ts` et `api/grading-router.ts` | ✅ |
| 3.5.10 | `evaluation-router.ts` (listPublic / listForTeacher / seed) + `db/seed-evaluation.ts` | ✅ |
| 3.5.11 | Tests de non-régression : surface publique + aller-retour QCM (25 tests) | ✅ |
| 3.5.12 | `.env.example` complété (secrets de session, clé LLM, origines) | ✅ |
| 3.5.13 | CHANGELOG `v0.3.5-convergence` | ✅ |

---

## Phase 4 — Atelier QCM enseignant (papier + en ligne) ✅ (branche `phase-4-atelier-qcm`)

**But** : l'enseignant compose un QCM assisté par LLM (ancré sur un RAG), l'imprime
via AMC, saisit à la main les réponses des copies papier, et obtient les notes.
Le parcours en ligne des Phases 1 à 3.5 est conservé : une évaluation porte un
`deliveryMode` (`online`, `paper`, `both`).

**Ce qu'on ne réécrit pas.** `auto-multiple-choice` 1.6.0 est installé et fait
déjà la mise en page LaTeX, les feuilles-réponses avec cases de calage, le
mélange par élève et la lecture optique. L'application pilote AMC, elle ne le
remplace pas. Contrat CLI relevé dans `QCM_EDS_MATHS_TERM/prepare_korrigo.sh` :

```
auto-multiple-choice prepare --mode s --prefix <dir> sujet.tex   # sujet + corrigé
auto-multiple-choice meptex --src calage.xy --data <dir>/data    # calage des cases
auto-multiple-choice prepare --mode b --data <dir>/data sujet.tex # barème
```

### Lot 0 : Rendre le projet exécutable ✅ [BLOQUANT]
Aucune des phases précédentes n'a pu être vérifiée en exécution : ni MySQL ni
`.env` sur la machine. Tout ce qui touche la base resterait non vérifié.

| # | Tâche | Statut |
|---|-------|--------|
| 0.1 | `docker-compose.dev.yml` : MySQL 8.4 sur 127.0.0.1:3307, volume nommé | ✅ |
| 0.2 | `.env` de développement + migrations + seed (20 questions, toutes avec rubric) | ✅ |
| 0.3 | `scripts/smoke-parcours-eleve.ts` : 22 vérifications HTTP bout en bout, vertes | ✅ |
| 0.4 | **Migration de référence** : `db/migrations/` ne contenait que des `ALTER` sans journal — aucune base ne pouvait être créée depuis le dépôt. Baseline régénérée depuis `db/schema.ts`, anciens fichiers dans `legacy/` | ✅ |
| 0.5 | **Contraintes déclarées à la source** : clés étrangères et clé primaire composite de `answer_drafts` n'existaient que dans le SQL manuel, donc absentes de toute base régénérée | ✅ |

### Lot A : Modèle de données de l'atelier ✅
| # | Tâche | Statut |
|---|-------|--------|
| A.1 | Migration `0001_workshop.sql` : `classes`, `students`, `paper_exams`, `paper_copies` | ✅ |
| A.2 | `evaluations` : `deliveryMode`, `ownerId`, `subject`, `level` ; `sessions.mode` (`online`/`paper`) | ✅ |
| A.3 | `db/schema.ts` + contraintes + types | ✅ |
| A.4 | `grade-session` corrige les copies papier (identité) comme les copies en ligne (reconversion) — 5 tests | ✅ |

### Lot B : Interface de création des QCM ✅
| # | Tâche | Statut |
|---|-------|--------|
| B.1 | `api/routers/authoring-router.ts` : CRUD évaluation + questions, réordonnancement, duplication (teacherQuery) | ✅ |
| B.2 | `contracts/question-coherence.ts` : refus des questions dont la fiche et le barème divergent — 18 tests + `scripts/smoke-atelier-enseignant.ts` | ✅ |
| B.3 | Page `/teacher/evaluations` : liste, création, duplication, activation | ✅ |
| B.4 | Page `/teacher/evaluations/:id` : éditeur, aperçu KaTeX en direct, réordonnancement | ✅ |
| B.5 | Éditeur QCM : propositions, bonne réponse, **diagnostic par distracteur** renvoyé à l'élève à la correction | ✅ |
| B.6 | 18 tests de cohérence + 6 tests de retour diagnostique + `scripts/dev-session.ts` pour atteindre l'IHM sans OAuth | ✅ |
| B.7 | **Correctif Tailwind** : les composants shadcn étaient écrits en syntaxe v4 (`w-(--sidebar-width)`) sous Tailwind 3.4, qui les ignore. La gouttière de la barre latérale faisait 0 px et le contenu passait dessous — sur le tableau de bord aussi, depuis toujours. 30 classes converties dans 10 composants | ✅ |

### Lot C : Assistance LLM (OpenRouter) ✅
| # | Tâche | Statut |
|---|-------|--------|
| C.1 | `api/llm/chat.ts` : transport partagé correction/génération, en-têtes OpenRouter, repli si `response_format` refusé | ✅ |
| C.1b | **Troncature détectée** via `finish_reason` : un modèle à raisonnement consomme le budget avant d'écrire, la coupure remontait sous la forme trompeuse d'un « JSON invalide » | ✅ |
| C.1c | **Garde-temps corrigé** : il était annulé dès la réception des en-têtes, donc ne couvrait pas la lecture du corps — seule partie réellement longue | ✅ |
| C.2 | `api/authoring/generate-questions.ts` : règle des **distracteurs diagnostiques**, interdits explicites (distracteur fantaisiste, double capacité, bonne réponse repérable à sa forme) | ✅ |
| C.3 | Routes `authoring.generateQuestions` et `authoring.llmStatus` (teacherQuery, plafond 12 générations / 5 min / enseignant) | ✅ |
| C.4 | `GenerationPanel` : thème, nombre, difficulté ; propositions rendues en LaTeX avec diagnostics ; « Ajouter à l'évaluation » ou « Retoucher » | ✅ |
| C.5 | 24 tests : contrat de sortie, JSON invalide, troncature, bonne réponse absente, incohérence signalée sans être jetée | ✅ |
| C.6 | **Budget recalibré** : mesuré 3 460 jetons de raisonnement pour une seule question difficile avec extraits. `max_tokens` est un plafond, pas une réservation — réserve fixe généreuse | ✅ |
| C.7 | **Schéma strict là où ça compte, tolérant ailleurs** : difficulté hors barème ramenée dans les bornes, diagnostic trop long coupé, plutôt que de perdre tout un lot | ✅ |
| C.8 | **Limite unique** `DIAGNOSTIC_MAX_LENGTH` : la troncature coupait à 600, le schéma exigeait 400 — toute proposition entre les deux était déclarée incohérente | ✅ |

### Lot D : Port RAG (interface maintenant, branchement plus tard) ✅
Le stack `nexusrag` est en panne au démarrage (`release manifest unavailable or
invalid`, `retrieval_v2_endpoint.py:559`). On définit le contrat sans en dépendre.

| # | Tâche | Statut |
|---|-------|--------|
| D.1 | `api/rag/rag-provider.ts` : `search(query, k) → RagPassage[]` avec référence citable | ✅ |
| D.2 | `NullRagProvider` (défaut) + `HttpRagProvider` (contrat v1 : `POST /search`, `x-api-key`, réponse Chroma) | ✅ |
| D.3 | Extraits injectés dans le prompt ; sources remontées à l'enseignant ; panne du RAG absorbée (génération sans ancrage) | ✅ |
| D.4 | 10 tests + vérification contre un vrai service HTTP : requête, collection, clé, citations | ✅ |

### Lot E : Export AMC et impression ✅
| # | Tâche | Statut |
|---|-------|--------|
| E.1 | `api/paper/amc-template.ts` : évaluation → LaTeX `automultiplechoice`, **sans aucun mélange** — condition de la saisie manuelle | ✅ |
| E.2 | Énoncés insérés tels quels (les échapper casserait les formules) + refus des primitives d'exécution (`\write18`, `\input`…) avant compilation | ✅ |
| E.3 | `api/paper/amc-runner.ts` : les 3 commandes AMC par `execFile` (sans shell), un dossier par tirage | ✅ |
| E.4 | `paper-router.ts` (classes, import CSV, tirages) + `GET /api/paper/:id/:file` : rôle vérifié, propriété vérifiée, noms de fichiers en liste fermée | ✅ |
| E.5 | `PrintPanel` : classe, import de liste, intitulé, génération, téléchargements, tirages précédents | ✅ |
| E.6 | 29 tests + production réelle vérifiée : 15 pages A4, 3 copies nominatives, 16 questions grillées, corrigé exact | ✅ |

### Lot F : Saisie manuelle et notation ✅
S'inspire de `QCM_EDS_MATHS_TERM/manual_entry.{html,js,css}`, qui fonctionne
déjà : grille par élève, progression, validation, score immédiat.

| # | Tâche | Statut |
|---|-------|--------|
| F.1 | Import CSV de la liste d'élèves : BOM, guillemets, point-virgule, noms composés, doublons signalés — 11 tests | ✅ |
| F.7 | **Composition figée au tirage** (`printedQuestionIds`) : la grille de saisie reflète le papier, pas l'état courant des questions | ✅ |
| F.8 | **Boucle infinie corrigée dans `MathLatex`** : un `$` non apparié figeait la page entière — le parseur ne progressait plus | ✅ |
| F.9 | **Notation des questions rédigées** : elles ne se cochent pas mais se notent à la main sur la copie ; leur barème s'ajoute à celui de la grille | ✅ |
| F.10 | **Notes manuelles préservées** : `gradeSessionResponses` réécrivait toutes les réponses, effaçant en silence les points attribués par l'enseignant — `overrideGrade` compris | ✅ |
| F.2 | `manual-entry.ts` : copie saisie → session `mode='paper'` → `gradeSessionResponses` ; conversion des lettres (A→« true » pour les vrai/faux) | ✅ |
| F.3 | Page `/teacher/saisie/:examId` : un élève à la fois, saisie entièrement au clavier, reprise et ressaisie | ✅ |
| F.4 | Notation par le moteur partagé, **barème restreint aux questions imprimées** — sans quoi une copie parfaite plafonnait à 13,5/20 | ✅ |
| F.5 | Export CSV : BOM, point-virgule, virgule décimale — lisible tel quel par Excel en configuration française | ✅ |
| F.6 | 47 tests + parcours réel : copie juste 20/20, copie fausse 0, copie partielle exacte, ressaisie qui remplace | ✅ |

### Lot G : Vérification ✅
| # | Tâche | Statut |
|---|-------|--------|
| G.1 | `check && lint && test && build` verts — 383 tests | ✅ |
| G.2 | `scripts/smoke-chaine-papier.ts` : 14 contrôles depuis zéro, copie juste 20/20, copie fausse 0 | ✅ |
| G.3 | CHANGELOG `v0.4.0-atelier-qcm` | ✅ |

---

## Phase 5 — DevOps, qualité, go-live (branche `phase-5-devops`)

| # | Tâche | Statut |
|---|---|---|
| 5.1 | `Dockerfile` multi-stage (node:22-slim), utilisateur non privilégié, healthcheck — image construite et exécutée | ✅ |
| 5.2 | `docker-compose.yml` (MySQL 8.4 + app). Redis écarté : la limitation de débit est en mémoire, il ne servirait qu'en multi-instances — noté dans SECURITY.md | ✅ |
| 5.3 | `.github/workflows/ci.yml` : types, style, tests, build ; **création de la base depuis le dépôt** ; construction de l'image | ✅ |
| 5.4 | `GET /api/health` — existait déjà ; branché sur le healthcheck du conteneur | ✅ |
| 5.5 | Logger Pino ou wrapper structuré JSON avec requestId | ⬜ |
| 5.6 | Sentry optionnel (`SENTRY_DSN`) | ⬜ |
| 5.7 | `README.md` réécrit : le parcours réel, le démarrage local vérifié, les points de conception | ✅ |
| 5.8 | `DEPLOYMENT.md` : secrets, reverse proxy (délai 300 s pour la génération), image AMC dérivée, sauvegardes | ✅ |
| 5.9 | `SECURITY.md` : six menaces traitées, données personnelles, limites connues | ✅ |
| 5.10 | `/mentions-legales` et `/confidentialite` (mentions manquantes affichées comme telles, jamais inventées) ; export JSON complet et **anonymisation** par élève | ✅ |
| 5.11 | Test de charge k6 (200 élèves concurrents, p95 < 500ms) | ⬜ |
| 5.12 | Découpage par route + bibliothèques lourdes isolées : élève 1,75 Mo → ~1,0 Mo, enseignant → 756 Ko | ✅ |
| 5.13 | Interface 100 % FR + `lang="fr"`, titre, description et icône d'onglet | ✅ |
| 5.14 | CHANGELOG.md Phase 5 | ⬜ |
| 5.15 | Tag `v1.0.0-rc1` après revue de Shark | ⬜ |

---

## Critères d'acceptation Go-Live (§VIII.4)

- [x] 1. Aucune route publique ne renvoie `correctAnswer`
- [x] 2. Chaque mutation élève exige un `sessionToken` valide non expiré
- [x] 3. Submit impossible après expiration serveur du timer
- [x] 4. Score, tabSwitchCount, cheatEvents non falsifiables par le client
- [x] 5. Dashboard prof exige le rôle `teacher`
- [ ] 6. Correction des 5 RC accepte ≥ 5 variantes équivalentes (test paramétré)
- [ ] 7. Rendu LaTeX correct sur Chrome, Firefox, Safari, mobile
- [ ] 8. Saisie MathLive fonctionnelle et exploitable côté serveur
- [ ] 9. Auto-save survit à 30s de coupure réseau
- [ ] 10. Heartbeat détecte déconnexion à 60s, auto-submit à 180s
- [ ] 11. Score de suspicion calculé + affiché au prof avec verdict
- [ ] 12. Coverage ≥ 80% global, ≥ 100% sur `api/grading/`
- [x] 13. Migrations Drizzle committées dans `db/migrations/`
- [ ] 14. `docker compose up` < 30s
- [ ] 15. CI GitHub Actions verte sur `main`
- [ ] 16. 0 `any`, 0 `// @ts-ignore` non commenté
- [ ] 17. Audit log : 100% des modifications de scores manuels
- [ ] 18. Export CSV et PDF fonctionnel
- [x] 19. Login + AuthLayout + NotFound en français FR-FR
- [ ] 20. k6 : 200 élèves concurrents, p95 < 500ms, 0 erreur
- [x] 21. RGPD : mentions légales + confidentialité + export utilisateur
- [x] 22. SECURITY.md à jour
- [x] 23. README.md réécrit, quickstart fonctionnel sur machine vierge
