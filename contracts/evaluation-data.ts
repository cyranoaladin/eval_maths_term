import type { EvaluationQuestion } from "./types";

export const EVALUATION_TITLE = "Évaluation de Mathématiques — Terminale EDS";
export const EVALUATION_DESCRIPTION = "Cette évaluation porte sur les chapitres du programme de terminale spécialité mathématiques : suites, limites, dérivation, fonction logarithme, intégration, équations différentielles et probabilités.";
export const EVALUATION_DURATION = 60; // minutes

export const evaluationQuestions: Omit<EvaluationQuestion, "id" | "evaluationId">[] = [
  // ========== QCM (10 questions, 1 point chacune) ==========

  // QCM 1 — Suites (convergence)
  {
    type: "qcm",
    question: "Soit (u_n) la suite définie par u_0 = 2 et u_{n+1} = 0.5 u_n + 1 pour tout n ∈ ℕ. Cette suite converge vers :",
    options: [
      "0",
      "1",
      "2",
      "4"
    ],
    correctAnswer: "2", // 2
    points: 1,
    order: 1,
  },

  // QCM 2 — Limites de fonctions
  {
    type: "qcm",
    question: "La limite de f(x) = (3x² − 2x + 1)/(x² + 5) quand x tend vers +∞ est égale à :",
    options: [
      "+∞",
      "0",
      "3",
      "1/5"
    ],
    correctAnswer: "2", // 3
    points: 1,
    order: 2,
  },

  // QCM 3 — Fonction logarithme
  {
    type: "qcm",
    question: "Pour tout réel x > 0, l'expression ln(x²) − 2ln(x) est égale à :",
    options: [
      "ln(2x) − 2ln(x)",
      "0",
      "ln(x² − 2x)",
      "2"
    ],
    correctAnswer: "1", // 0
    points: 1,
    order: 3,
  },

  // QCM 4 — Probabilités / Loi binomiale
  {
    type: "qcm",
    question: "On lance 10 fois de suite une pièce équilibrée. La variable aléatoire comptant le nombre de piles obtenus suit la loi :",
    options: [
      "uniforme sur {0, 1, ..., 10}",
      "binomiale ℬ(10; 0.5)",
      "de Bernoulli de paramètre 0.5",
      "normale"
    ],
    correctAnswer: "1", // binomiale B(10;0.5)
    points: 1,
    order: 4,
  },

  // QCM 5 — Dérivation (produit + composée)
  {
    type: "qcm",
    question: "La dérivée de la fonction f définie sur ℝ par f(x) = x · e^x est :",
    options: [
      "e^x",
      "x · e^x",
      "(x + 1) e^x",
      "x + e^x"
    ],
    correctAnswer: "2", // (x+1)e^x
    points: 1,
    order: 5,
  },

  // QCM 6 — Intégration
  {
    type: "qcm",
    question: "L'intégrale ∫₀¹ (2x + 1) dx est égale à :",
    options: [
      "1",
      "2",
      "3",
      "0"
    ],
    correctAnswer: "1", // 2
    points: 1,
    order: 6,
  },

  // QCM 7 — TVI (Théorème des valeurs intermédiaires)
  {
    type: "qcm",
    question: "Soit f une fonction continue sur [a; b]. Si f(a) · f(b) < 0, alors on peut affirmer que :",
    options: [
      "f admet un maximum sur [a; b]",
      "l'équation f(x) = 0 admet au moins une solution dans [a; b]",
      "f est strictement monotone sur [a; b]",
      "f est dérivable sur ]a; b["
    ],
    correctAnswer: "1", // TVI
    points: 1,
    order: 7,
  },

  // QCM 8 — Convexité (dérivée seconde)
  {
    type: "qcm",
    question: "Soit f une fonction deux fois dérivable sur un intervalle I. Si f''(x) > 0 pour tout x ∈ I, alors :",
    options: [
      "f est concave sur I",
      "f est convexe sur I",
      "f est décroissante sur I",
      "f admet un point d'inflexion sur I"
    ],
    correctAnswer: "1", // convexe
    points: 1,
    order: 8,
  },

  // QCM 9 — Équations différentielles
  {
    type: "qcm",
    question: "Les solutions de l'équation différentielle y' = 2y sur ℝ sont les fonctions de la forme :",
    options: [
      "y(x) = C e^(2x) où C ∈ ℝ",
      "y(x) = 2x + C où C ∈ ℝ",
      "y(x) = C e^x où C ∈ ℝ",
      "y(x) = x² + C où C ∈ ℝ"
    ],
    correctAnswer: "0", // Ce^(2x)
    points: 1,
    order: 9,
  },

  // QCM 10 — Loi binomiale (espérance)
  {
    type: "qcm",
    question: "Une variable aléatoire X suit la loi binomiale ℬ(5; 0.3). L'espérance E(X) est égale à :",
    options: [
      "0.3",
      "1.5",
      "5",
      "1.05"
    ],
    correctAnswer: "1", // 1.5
    points: 1,
    order: 10,
  },

  // ========== RÉPONSES COURTES (5 questions, 2 points chacune) ==========

  // RC 11 — Limite de suite
  {
    type: "short_answer",
    question: "Déterminez la limite de la suite (u_n) définie par u_n = (2n + 3)/(n + 1) quand n tend vers +∞. Justifiez brièvement votre réponse.",
    correctAnswer: "2",
    points: 2,
    order: 11,
  },

  // RC 12 — Dérivation (composée)
  {
    type: "short_answer",
    question: "Soit f la fonction définie sur ℝ par f(x) = e^(2x) − 3x. Déterminez l'expression de f'(x), la dérivée de f.",
    correctAnswer: "2e^(2x)-3",
    points: 2,
    order: 12,
  },

  // RC 13 — Intégration (logarithme)
  {
    type: "short_answer",
    question: "Calculez l'intégrale I = ∫₁² (1/x) dx. Donnez la valeur exacte.",
    correctAnswer: "ln(2)",
    points: 2,
    order: 13,
  },

  // RC 14 — Équation différentielle (y' = ay + b)
  {
    type: "short_answer",
    question: "Résolvez l'équation différentielle y' = −2y + 4 avec la condition initiale y(0) = 1. Donnez l'expression de y(x).",
    correctAnswer: "2-e^(-2x)",
    points: 2,
    order: 14,
  },

  // RC 15 — Probabilités (dénombrement)
  {
    type: "short_answer",
    question: "Une urne contient 5 boules rouges et 3 boules bleues, indiscernables au toucher. On tire successivement et avec remise 2 boules. Quelle est la probabilité d'obtenir deux boules de la même couleur ? Donnez le résultat sous forme d'une fraction irréductible.",
    correctAnswer: "17/32",
    points: 2,
    order: 15,
  },

  // ========== VRAI/FAUX avec justification (5 questions, 2 points chacune) ==========

  // VF 16 — Suites (théorème de convergence)
  {
    type: "true_false",
    question: "Toute suite croissante et majorée converge.",
    correctAnswer: "true",
    justificationRequired: true,
    points: 2,
    order: 16,
  },

  // VF 17 — Dérivation / continuité
  {
    type: "true_false",
    question: "Si une fonction f est dérivable en un réel a, alors f est continue en a.",
    correctAnswer: "true",
    justificationRequired: true,
    points: 2,
    order: 17,
  },

  // VF 18 — Logarithme (propriété algébrique)
  {
    type: "true_false",
    question: "Pour tous réels a > 0 et b > 0, on a ln(a + b) = ln(a) + ln(b).",
    correctAnswer: "false",
    justificationRequired: true,
    points: 2,
    order: 18,
  },

  // VF 19 — Intégration (positivité)
  {
    type: "true_false",
    question: "Si f est une fonction positive et continue sur un intervalle [a; b], alors ∫ₐᵇ f(x) dx ≥ 0.",
    correctAnswer: "true",
    justificationRequired: true,
    points: 2,
    order: 19,
  },

  // VF 20 — Loi binomiale (variance)
  {
    type: "true_false",
    question: "Si une variable aléatoire X suit la loi binomiale ℬ(n, p), alors sa variance est V(X) = np.",
    correctAnswer: "false",
    justificationRequired: true,
    points: 2,
    order: 20,
  },
];

export const MAX_SCORE = evaluationQuestions.reduce((sum, q) => sum + q.points, 0);
