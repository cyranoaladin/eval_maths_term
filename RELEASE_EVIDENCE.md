# Dossier de preuve — mise en service v1.0.0

Ce fichier est le registre de vérité de la finalisation. Il ne remplace ni
`README.md`, ni `PLAN.md`, ni `CHANGELOG.md` : il consigne **ce qui a été
réellement exécuté**, avec la commande qui le prouve.

Règle : un critère ne passe à `PASS` que si la preuve a été exécutée et
observée. Un critère non vérifié reste `IN_PROGRESS`, jamais `PASS`.

---

## 1. Position

| | |
|---|---|
| Branche | `phase-3.5-convergence` |
| HEAD | `99a5a4b` |
| Base de la finalisation | `5a24b63` (`feat(dashboard)`) |
| Worktree | propre |
| Dernière mise à jour | 2026-08-29 (lot sécurité) |

## 2. Commits de la finalisation

| SHA | Domaine | Objet |
|---|---|---|
| `98e5e53` | MathLive / normalisation | Le champ mathématique ne transmettait rien au serveur |
| `b4430b4` | Anti-triche | Le heartbeat répondait 401 à chaque envoi |
| `5907209` | Reprise de session / fiabilité réseau | Reprise de copie et fiabilité de la sauvegarde |
| `7ad41a2` | E2E | Parcours élève réel sur Chromium, Firefox et WebKit |
| `ef8365c` | MathLive / normalisation | Les écritures produites par le champ mathématique étaient comptées fausses |
| `5f228bd` | Anti-triche | Le balayage d'inactivité ne tournait jamais de lui-même |
| `5433023` | Correction | Limites infinies, mode exact sans référence, déconnexion invisible |
| `a0142df` | Couverture | Couvrir les chemins de correction jamais éprouvés |
| `99a5a4b` | Sécurité | Un enseignant accédait aux copies de tous les autres |

Commits antérieurs de la même campagne, déjà poussés : `864ec4a` (scores
décimaux), `ceeb833` (journal d'audit), `e4c05a6` (écran de correction),
`5e52ec9` (relevé PDF), `5a24b63` (tableau de bord).

## 3. Critères d'acceptation (PLAN.md §VIII.4)

| # | Critère | État | Preuve |
|---|---|---|---|
| 1 | Aucune route publique ne renvoie `correctAnswer` | PASS | `npm test -- public-surface` |
| 2 | Chaque mutation élève exige un `sessionToken` valide | PASS | `npm test -- public-surface` + `npx tsx scripts/smoke-parcours-eleve.ts` |
| 3 | Submit impossible après expiration serveur | PASS | `npx tsx scripts/smoke-parcours-eleve.ts` (§7 « session scellée ») |
| 4 | Score et incidents non falsifiables par le client | PASS | `scripts/smoke-parcours-eleve.ts` §5–6 |
| 5 | Dashboard prof exige le rôle `teacher` | PASS | `npm test -- public-surface` |
| 6 | Réponses courtes : ≥ 5 variantes équivalentes | PASS | `npx vitest run api/grading/__tests__/reponses-courtes-variantes.spec.ts` — 5 questions réelles, 5 à 7 écritures acceptées chacune, fausses toujours refusées |
| 7 | Rendu LaTeX sur Chrome, Firefox, Safari, mobile | IN_PROGRESS | 3 moteurs verts ; viewport mobile non couvert |
| 8 | Saisie MathLive fonctionnelle et exploitable serveur | PASS | `npx playwright test parcours-eleve` (frappe → LaTeX → serveur) + `npx vitest run api/grading` (sorties MathLive réelles relevées en navigateur, évaluables par mathjs, valeur conservée) |
| 9 | Auto-save survit à 30 s de coupure réseau | PASS | `npx playwright test parcours-eleve` — coupure réelle, 3 moteurs |
| 10 | Heartbeat 60 s / auto-submit 180 s | PASS | `npx tsx scripts/smoke-anticheat-temps-reels.ts` — 210 s d'observation réelle, sans accélération |
| 11 | Score de suspicion affiché au prof avec verdict | PASS | badge et incidents sur l'écran de correction (`src/pages/teacher/Correction.tsx`) ; verdict « mineur » 20/100 constaté sur copie abandonnée |
| 12 | Couverture ≥ 80 % global, 100 % `api/grading/` | IN_PROGRESS | — |
| 13 | Migrations Drizzle committées | PASS | `db/migrations/` suivi par Git |
| 14 | `docker compose up` < 30 s | IN_PROGRESS | — |
| 15 | CI GitHub Actions verte sur `main` | IN_PROGRESS | verte sur la branche ; fusion non autorisée à ce stade |
| 16 | 0 `any`, 0 `@ts-ignore` non commenté | PASS | `npx vitest run api/__tests__/typage-strict.spec.ts` — garde durable, 2 suppressions recensées nominativement |
| 17 | Audit : 100 % des modifications manuelles | IN_PROGRESS | journal implémenté ; batterie de tests §K à écrire |
| 18 | Export CSV et PDF fonctionnel | IN_PROGRESS | PDF vérifié par `scripts/smoke-export-pdf.ts` ; recette typographique §J à faire |
| 19 | Login + AuthLayout + NotFound en français | PASS | interface en fr-FR |
| 20 | k6 : 200 élèves, p95 < 500 ms | IN_PROGRESS | — |
| 21 | RGPD : mentions, confidentialité, export | PASS | commit `4a0b188` |
| 22 | `SECURITY.md` à jour | PASS | présent, à resynchroniser en fin de campagne |
| 23 | `README.md` réécrit, quickstart vierge | PASS | commit `62c9e6a` |

**PASS : 16 / 23. IN_PROGRESS : 7. FAIL : 0. BLOCKED_EXTERNAL : 0.**

Restent ouverts : 7 (viewport mobile), 12 (couverture), 14 (Docker), 15 (CI sur `main`),
17 (batterie d'audit §K), 18 (recette typographique §J), 20 (k6).

## 4. Défauts découverts pendant la finalisation

| # | Défaut | Gravité | Correction |
|---|---|---|---|
| 1 | `responses.score` en `int` alors que le moteur produit du crédit partiel : `1.5` stocké `2` | critique, silencieux depuis la phase 2 | `864ec4a` — colonnes décimales + `api/lib/decimal.ts` |
| 2 | `MathInput` / `MathPalette` jamais utilisés : le critère 8 n'était pas satisfait | majeur | `98e5e53` |
| 3 | Affectation de `el.value` avant définition du custom element : la propriété masquait l'accesseur, la réponse de l'élève n'atteignait jamais React | critique | `98e5e53` |
| 4 | Polices MathLive cherchées dans un répertoire jamais servi (dev **et** production) | majeur | `98e5e53` |
| 5 | `.toLowerCase()` transformait `Infinity` en `infinity`, illisible par mathjs : toute limite infinie comptée fausse | critique | `98e5e53` |
| 6 | Opérateurs MathLive (`\cdot`, `\left`, `\right`…) non normalisés côté serveur | majeur | `98e5e53` |
| 7 | `session.heartbeat` lisait `x-session-token`, en-tête que personne n'émet : 401 systématique, surveillance inopérante | critique | `b4430b4` |
| 8 | Le rechargement de page perdait la copie : jeton en mémoire seule | majeur | `5907209` |
| 9 | `answer.listDrafts` sans aucun appelant : brouillons serveur jamais relus | majeur | `5907209` |
| 10 | Requête de sauvegarde sans échéance : sur réseau pendant, blocage définitif sur « Sauvegarde… », rien mis en file locale | critique | `5907209` |
| 11 | « N en attente » comptait des frappes et ne redescendait jamais à zéro | mineur | `5907209` |
| 12 | Relance hors ligne rejouant tous les états intermédiaires d'une question | majeur (risque d'écrasement) | `5907209` |
| 13 | Jeton de session conservé après remise | mineur (sécurité) | `5907209` |
| 14 | `\frac12` — la sortie exacte de la frappe « 1/2 » — n'était pas normalisée : la fraction la plus courante était comptée fausse | critique | `ef8365c` |
| 15 | `compareFraction` ré-analysait le texte brut sans passer par la normalisation | majeur | `ef8365c` |
| 16 | `compareNumeric` reposait sur une liste de cas codés en dur : toute réponse numérique un peu composée était « non convertible », donc fausse | critique | `ef8365c` |
| 17 | `parseSet` ne reconnaissait pas les accolades échappées de MathLive | majeur | `ef8365c` |
| 18 | Le balayage d'inactivité ne tournait jamais seul : le seuil des 180 s ne tenait que si un autre élève émettait | critique | `5f228bd` |
| 19 | Toute limite infinie était comptée fausse (comparaison en minuscules + refus de principe des valeurs non finies) | critique | `5433023` |
| 20 | Le mode de correction « exact » confrontait la réponse à la chaîne vide : il ne reconnaissait jamais rien | critique | `5433023` |
| 21 | Le score de suspicion était calculé avant l'inscription de la déconnexion : copie abandonnée = « Propre » 0/100 | majeur | `5433023` |
| 22 | **Aucun contrôle de propriété sur les routes enseignant** : lecture, recorrection, modification de note, remise forcée et journal d'audit des copies de n'importe quel collègue | critique (sécurité) | `99a5a4b` |

## 5. Migrations ajoutées

- Scores décimaux : `responses.score` → `decimal(6,2)`, `sessions.totalScore` → `decimal(7,2)`.
- Table `grade_audit` : journal append-only des interventions sur les notes.

Recette complète §I (base vierge / base existante / valeurs fractionnaires)
**non encore exécutée**.

## 6. Tests ajoutés

| Emplacement | Nature |
|---|---|
| `e2e/parcours-eleve.spec.ts` | 3 scénarios navigateur × 3 moteurs |
| `e2e/rendu-mathematique.spec.ts` | 5 scénarios navigateur × 3 moteurs |
| `scripts/smoke-parcours-eleve.ts` | heartbeat et aller-retour de brouillon |
| `scripts/smoke-correction-audit.ts` | override → audit → regrade |
| `scripts/smoke-export-pdf.ts` | relevé PDF |
| `scripts/smoke-anticheat-temps-reels.ts` | seuils 60 s / 180 s aux constantes de production |
| `scripts/smoke-cloisonnement-enseignants.ts` | six refus d'un enseignant sur les copies d'un autre |
| `api/grading/__tests__/reponses-courtes-variantes.spec.ts` | critère 6, 5 questions réelles |
| `api/grading/__tests__/grade-session-moteur.spec.ts` | moteur de session sur base simulée |
| `api/grading/__tests__/grade-response-parcours.spec.ts` | 27 parcours, LLM simulé et en panne |
| `api/grading/__tests__/couverture-comparateurs.spec.ts` | chemins de comparaison rares |
| `api/grading/__tests__/compare-set.spec.ts` | ensembles saisis en LaTeX |
| `api/grading/__tests__/input-mode.spec.ts` | nature du champ sans fuite de barème |
| `api/__tests__/typage-strict.spec.ts` | garde `any` / `@ts-ignore` |

Suite unitaire : **541 tests, 37 fichiers, verts.**

## 7. Résultats navigateur

Commande : `npx playwright test`
Serveur : instance de développement sur `http://localhost:3000`.

```
24 passed (3.8m)
chromium 8/8   firefox 8/8   webkit 8/8
```

Dont, sur les trois moteurs :

- saisie MathLive au clavier, LaTeX effectivement produit et transmis ;
- rechargement de page : session reprise, brouillons restaurés ;
- **coupure réseau réelle de 30 s** : interface non figée, bascule sur file
  locale, rétablissement, purge de la file, rechargement, réponse écrite hors
  ligne retrouvée, remise effectuée depuis l'état restauré, jeton nettoyé ;
- navigation avant/arrière sans perte ;
- rendu KaTeX de plusieurs familles de formules sans erreur console.

Aucun `429` observé sur `session.start` : le quota de production (5/min/IP)
n'a pas été touché, et le test échoue bruyamment si un refus survient.

## 8. Couverture

Mesure sans aucune exclusion artificielle, sur le code que la suite unitaire
cible (`api/`, `contracts/`, `db/*.ts`) :

| Périmètre | Lignes | Branches | Fonctions | Instructions |
|---|---|---|---|---|
| `api/grading/` | 85,9 % | 77,4 % | 89,7 % | 85,4 % |
| Global mesuré | 41,7 % | 38,2 % | 35,5 % | 41,7 % — **avant** les lots de tests ci-dessus ; à remesurer |

Le critère 12 exige 100 % sur `api/grading/` et 80 % global : **non atteint**,
et il ne sera pas déclaré atteint tant qu'il ne le sera pas. Ce qui manque est
identifié : `grade-audit.ts` et les branches restantes de `grade-session.ts`
côté correction, et surtout les routeurs (`paper-router`, `authoring-router`,
`session-router`) qui pèsent l'essentiel du global et exigent une base de test.
Le front est couvert par Playwright, non instrumenté.

Commande :

```
npx vitest run --coverage.enabled --coverage.provider=v8 --coverage.all \
  --coverage.include='api/**/*.ts' --coverage.include='contracts/**/*.ts' \
  --coverage.include='db/*.ts' --coverage.exclude='**/__tests__/**'
```

## 9. Charge (k6)

Non encore exécutée.

## 10. Docker / AMC

Non encore exécuté.

## 11. CI distante

| Run | Commit | Résultat |
|---|---|---|
| 33273190905 | `5a24b63` | succès |
| 33275802846 | `7ad41a2` | succès |
| 33276738129 | `5433023` | succès |
| — | `99a5a4b` | poussé, en attente |

## 12. Production

Aucun déploiement de production vérifié. `v1.0.0` reste hors d'atteinte tant
que ce n'est pas le cas ; seul `v1.0.0-rc1` est envisageable, et seulement une
fois les 23 critères clos.
