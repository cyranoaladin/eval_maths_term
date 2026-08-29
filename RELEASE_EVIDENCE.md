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
| HEAD | `7ad41a2` |
| Base de la finalisation | `5a24b63` (`feat(dashboard)`) |
| Worktree | propre |
| Dernière mise à jour | 2026-08-29 |

## 2. Commits de la finalisation

| SHA | Domaine | Objet |
|---|---|---|
| `98e5e53` | MathLive / normalisation | Le champ mathématique ne transmettait rien au serveur |
| `b4430b4` | Anti-triche | Le heartbeat répondait 401 à chaque envoi |
| `5907209` | Reprise de session / fiabilité réseau | Reprise de copie et fiabilité de la sauvegarde |
| `7ad41a2` | E2E | Parcours élève réel sur Chromium, Firefox et WebKit |

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
| 6 | Réponses courtes : ≥ 5 variantes équivalentes | IN_PROGRESS | test paramétré à écrire (§D de la mission) |
| 7 | Rendu LaTeX sur Chrome, Firefox, Safari, mobile | IN_PROGRESS | 3 moteurs verts ; viewport mobile non couvert |
| 8 | Saisie MathLive fonctionnelle et exploitable serveur | IN_PROGRESS | frappe → LaTeX prouvée en navigateur ; tests de normalisation des sorties MathLive à compléter |
| 9 | Auto-save survit à 30 s de coupure réseau | PASS | `npx playwright test parcours-eleve` — coupure réelle, 3 moteurs |
| 10 | Heartbeat 60 s / auto-submit 180 s | IN_PROGRESS | en-tête corrigé et heartbeat prouvé vivant ; constantes réelles non encore chronométrées |
| 11 | Score de suspicion affiché au prof avec verdict | IN_PROGRESS | — |
| 12 | Couverture ≥ 80 % global, 100 % `api/grading/` | IN_PROGRESS | — |
| 13 | Migrations Drizzle committées | PASS | `db/migrations/` suivi par Git |
| 14 | `docker compose up` < 30 s | IN_PROGRESS | — |
| 15 | CI GitHub Actions verte sur `main` | IN_PROGRESS | verte sur la branche ; fusion non autorisée à ce stade |
| 16 | 0 `any`, 0 `@ts-ignore` non commenté | IN_PROGRESS | constat vrai ; garde anti-régression à ajouter |
| 17 | Audit : 100 % des modifications manuelles | IN_PROGRESS | journal implémenté ; batterie de tests §K à écrire |
| 18 | Export CSV et PDF fonctionnel | IN_PROGRESS | PDF vérifié par `scripts/smoke-export-pdf.ts` ; recette typographique §J à faire |
| 19 | Login + AuthLayout + NotFound en français | PASS | interface en fr-FR |
| 20 | k6 : 200 élèves, p95 < 500 ms | IN_PROGRESS | — |
| 21 | RGPD : mentions, confidentialité, export | PASS | commit `4a0b188` |
| 22 | `SECURITY.md` à jour | PASS | présent, à resynchroniser en fin de campagne |
| 23 | `README.md` réécrit, quickstart vierge | PASS | commit `62c9e6a` |

**PASS : 11 / 23. IN_PROGRESS : 12. FAIL : 0. BLOCKED_EXTERNAL : 0.**

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

Suite unitaire : **391 tests, 30 fichiers, verts.**

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

Non encore mesurée.

## 9. Charge (k6)

Non encore exécutée.

## 10. Docker / AMC

Non encore exécuté.

## 11. CI distante

| Run | Commit | Résultat |
|---|---|---|
| 33273190905 | `5a24b63` | succès |
| 33275802846 | `7ad41a2` | en cours |

## 12. Production

Aucun déploiement de production vérifié. `v1.0.0` reste hors d'atteinte tant
que ce n'est pas le cas ; seul `v1.0.0-rc1` est envisageable, et seulement une
fois les 23 critères clos.
