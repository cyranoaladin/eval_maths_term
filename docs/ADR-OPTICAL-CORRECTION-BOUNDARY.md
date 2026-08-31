# Où s'arrête la chaîne papier de la version 1.0.0-rc2

**Statut** : accepté · 31 août 2026
**Portée** : `v1.0.0-rc2` et le runtime qu'elle embarque

## La décision

```
RC2_PAPER_WORKFLOW  = generate → print → manual entry → grading
OPTICAL_CAPTURE     = NOT IMPLEMENTED IN RC2 WEB APP
INTEGRATED_OPTICAL_SCAN_RC2      = OUT_OF_SCOPE
OPTICAL_SCAN_FUTURE_CAPABILITY   = PRESERVED
```

`v1.0.0-rc2` décrit le produit **réellement implémenté** : composition et
passage en ligne, rédaction des évaluations, génération des sujets papier,
saisie manuelle des réponses, correction et résultats.

Ce n'est pas une décision sur l'avenir. Nous ne disons pas que le produit
n'analysera jamais de copies scannées ; nous disons que la version candidate ne
le fait pas, et que son runtime ne doit pas porter ce qu'il faudrait pour le
faire.

## Ce qui existait, et pourquoi ce n'était pas appelé

`auto-multiple-choice` couvre la chaîne entière : composition, calage, lecture
optique, association des copies, export. Notre appel en enchaînait trois
étapes :

| Étape | Produit | Lu par l'application ? |
|---|---|---|
| `prepare --mode s` | `sujet.pdf`, `corrige.pdf`, `catalog.pdf`, `calage.xy` | **oui**, les trois PDF |
| `meptex` | `data/layout.sqlite` — position des cases sur la feuille | non |
| `prepare --mode b` | `data/scoring.sqlite` — barème au format optique | non |

Vérifié dans tout le dépôt : aucun code n'ouvre `layout.sqlite` ni
`scoring.sqlite`, et `calage.xy` n'était produit que pour `meptex`. La liste
fermée des documents téléchargeables ne contient que les trois PDF et les deux
relevés produits depuis la base. La grille de saisie travaille sur
`printedQuestionIds`, figé au tirage ; la note vient du moteur de correction,
qui lit la base.

Ces deux étapes préparaient donc **exclusivement** une lecture optique qui n'a
jamais lieu — au prix, à chaque tirage, de deux exécutions supplémentaires, et,
dans l'image de production, de toute la pile de traitement d'images qu'AMC tire
pour analyser des scans.

## Ce qui a été retiré, et ce qui ne l'a pas été

Retiré du **runtime** : l'appel à `meptex`, l'appel à `prepare --mode b`, et les
dossiers `data/` et `cr/` qui n'existaient que pour eux.

Non retiré : rien de l'histoire. La chaîne optique d'AMC existe, elle est
documentée, et le savoir-faire du dépôt d'origine
(`QCM_EDS_MATHS_TERM/prepare_korrigo.sh`) reste consultable. Un test —
`api/paper/__tests__/amc-runner.spec.ts`, « ne prépare rien pour une correction
optique » — échoue si l'une des deux étapes revient sans décision explicite.

## L'architecture visée, si la lecture optique revient

Elle reviendra **hors du processus web**, dans un service distinct :

```
atelier-qcm-web              génération · saisie · notation
atelier-qcm-optical-worker   capture et analyse des scans   (n'existe pas)
```

Ce que ce service devra respecter, écrit maintenant pour ne pas l'inventer plus
tard : aucun accès public direct, aucun secret web, pas d'OAuth, pas
d'exposition Internet, système de fichiers borné, utilisateur non privilégié,
processeur et mémoire bornés, entrées contrôlées, et **sa propre image, sa
propre nomenclature logicielle et son propre gate de sécurité**.

Il n'est pas construit aujourd'hui : ce serait élargir le périmètre avant la
version candidate.

## Ce que cette décision coûte

Un établissement qui voudrait faire lire ses copies par une machine ne le peut
pas avec `v1.0.0-rc2`. Il saisit les réponses dans la grille — ce que le produit
fait, et ce que la recette éprouve de bout en bout.

En échange, l'image de production cesse de porter une pile de traitement
d'images entière pour un chemin que personne n'emprunte.
