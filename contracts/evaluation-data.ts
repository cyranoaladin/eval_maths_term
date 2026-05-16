import type { EvaluationQuestion } from "./types";

export const EVALUATION_TITLE = "Évaluation de Mathématiques — Terminale Spécialité";
export const EVALUATION_DESCRIPTION =
  "Évaluation portant sur les chapitres du programme de terminale spécialité mathématiques\u00a0: suites, limites, dérivation, fonction logarithme, intégration, équations différentielles et probabilités.";
export const EVALUATION_DURATION = 60; // minutes

export const evaluationQuestions: Omit<EvaluationQuestion, "id" | "evaluationId">[] = [
  // ========== QCM (10 questions, 1 point chacune) ==========

  // QCM 1 — Suites (convergence)
  {
    type: "qcm",
    question: "Soit $(u_n)$ la suite définie par $u_0 = 2$ et $u_{n+1} = 0{,}5\\,u_n + 1$ pour tout $n \\in \\mathbb{N}$. Cette suite converge vers\u00a0:",
    options: ["$0$", "$1$", "$2$", "$4$"],
    correctAnswer: "2",
    points: 1,
    order: 1,
    tags: ["suites", "convergence"],
    difficulty: 1,
    gradingRubric: {
      mode: { kind: "qcm", correctIndex: 2 },
      llmReviewRequired: false,
      weight: 1,
      detailedRubric: "Limite fixe de $u_{n+1} = 0{,}5\\,l + 1 \\Rightarrow l = 2$.",
    },
  },

  // QCM 2 — Limites de fonctions
  {
    type: "qcm",
    question: "La limite de $f(x) = \\dfrac{3x^2 - 2x + 1}{x^2 + 5}$ quand $x \\to +\\infty$ est\u00a0:",
    options: ["$+\\infty$", "$0$", "$3$", "$\\dfrac{1}{5}$"],
    correctAnswer: "2",
    points: 1,
    order: 2,
    tags: ["limites", "formes indéterminées"],
    difficulty: 1,
    gradingRubric: {
      mode: { kind: "qcm", correctIndex: 2 },
      llmReviewRequired: false,
      weight: 1,
      detailedRubric: "Diviser num. et dén. par $x^2$, les termes négligeables tendent vers 0.",
    },
  },

  // QCM 3 — Fonction logarithme
  {
    type: "qcm",
    question: "Pour tout réel $x > 0$, l'expression $\\ln(x^2) - 2\\ln(x)$ est égale à\u00a0:",
    options: ["$\\ln(2x) - 2\\ln(x)$", "$0$", "$\\ln(x^2 - 2x)$", "$2$"],
    correctAnswer: "1",
    points: 1,
    order: 3,
    tags: ["logarithme", "propriétés"],
    difficulty: 1,
    gradingRubric: {
      mode: { kind: "qcm", correctIndex: 1 },
      llmReviewRequired: false,
      weight: 1,
      detailedRubric: "$\\ln(x^2) = 2\\ln(x)$ donc $\\ln(x^2) - 2\\ln(x) = 0$.",
    },
  },

  // QCM 4 — Probabilités / Loi binomiale
  {
    type: "qcm",
    question: "On lance $10$ fois une pièce équilibrée. La variable aléatoire $X$ comptant le nombre de piles suit la loi\u00a0:",
    options: [
      "uniforme sur $\\{0,\\,1,\\,\\ldots,\\,10\\}$",
      "binomiale $\\mathcal{B}(10\\,;\\,0{,}5)$",
      "de Bernoulli de paramètre $0{,}5$",
      "normale",
    ],
    correctAnswer: "1",
    points: 1,
    order: 4,
    tags: ["probabilités", "loi binomiale"],
    difficulty: 1,
    gradingRubric: {
      mode: { kind: "qcm", correctIndex: 1 },
      llmReviewRequired: false,
      weight: 1,
      detailedRubric: "$n = 10$ épreuves indép., $p = 0{,}5$ → $\\mathcal{B}(10\\,;\\,0{,}5)$.",
    },
  },

  // QCM 5 — Dérivation (règle du produit)
  {
    type: "qcm",
    question: "La dérivée de la fonction $f$ définie sur $\\mathbb{R}$ par $f(x) = x\\,\\mathrm{e}^x$ est\u00a0:",
    options: [
      "$\\mathrm{e}^x$",
      "$x\\,\\mathrm{e}^x$",
      "$(x+1)\\,\\mathrm{e}^x$",
      "$x + \\mathrm{e}^x$",
    ],
    correctAnswer: "2",
    points: 1,
    order: 5,
    tags: ["dérivation", "règle du produit"],
    difficulty: 1,
    gradingRubric: {
      mode: { kind: "qcm", correctIndex: 2 },
      llmReviewRequired: false,
      weight: 1,
      detailedRubric: "Règle du produit\u00a0: $(u\\,v)' = u'v + uv' = \\mathrm{e}^x + x\\,\\mathrm{e}^x = (x+1)\\,\\mathrm{e}^x$.",
    },
  },

  // QCM 6 — Intégration
  {
    type: "qcm",
    question: "L'intégrale $\\displaystyle\\int_0^1 (2x + 1)\\,\\mathrm{d}x$ est égale à\u00a0:",
    options: ["$1$", "$2$", "$3$", "$0$"],
    correctAnswer: "1",
    points: 1,
    order: 6,
    tags: ["intégration", "intégrale définie"],
    difficulty: 1,
    gradingRubric: {
      mode: { kind: "qcm", correctIndex: 1 },
      llmReviewRequired: false,
      weight: 1,
      detailedRubric: "$[x^2 + x]_0^1 = 1 + 1 - 0 = 2$.",
    },
  },

  // QCM 7 — Théorème des valeurs intermédiaires
  {
    type: "qcm",
    // Correction pédagogique : ]a ; b[ (intervalle ouvert) conforme au programme
    question: "Soit $f$ une fonction continue sur $[a\\,;\\,b]$. Si $f(a)\\cdot f(b) < 0$, alors\u00a0:",
    options: [
      "$f$ admet un maximum sur $[a\\,;\\,b]$",
      "l'équation $f(x) = 0$ admet au moins une solution dans $]a\\,;\\,b[$",
      "$f$ est strictement monotone sur $[a\\,;\\,b]$",
      "$f$ est dérivable sur $]a\\,;\\,b[$",
    ],
    correctAnswer: "1",
    points: 1,
    order: 7,
    tags: ["continuité", "TVI"],
    difficulty: 2,
    gradingRubric: {
      mode: { kind: "qcm", correctIndex: 1 },
      llmReviewRequired: false,
      weight: 1,
      detailedRubric: "TVI\u00a0: si $f$ continue et $f(a)f(b)<0$, il existe $c\\in{}]a\\,;\\,b[$ tel que $f(c)=0$. L'intervalle est ouvert.",
    },
  },

  // QCM 8 — Convexité (dérivée seconde)
  {
    type: "qcm",
    question: "Soit $f$ une fonction deux fois dérivable sur un intervalle $I$. Si $f''(x) > 0$ pour tout $x \\in I$, alors\u00a0:",
    options: [
      "$f$ est concave sur $I$",
      "$f$ est convexe sur $I$",
      "$f$ est décroissante sur $I$",
      "$f$ admet un point d'inflexion sur $I$",
    ],
    correctAnswer: "1",
    points: 1,
    order: 8,
    tags: ["dérivation", "convexité"],
    difficulty: 2,
    gradingRubric: {
      mode: { kind: "qcm", correctIndex: 1 },
      llmReviewRequired: false,
      weight: 1,
      detailedRubric: "$f'' > 0$ sur $I$ $\\Leftrightarrow$ $f'$ croissante $\\Leftrightarrow$ $f$ convexe sur $I$.",
    },
  },

  // QCM 9 — Équations différentielles
  {
    type: "qcm",
    question: "Les solutions de l'équation différentielle $y' = 2y$ sur $\\mathbb{R}$ sont les fonctions de la forme\u00a0:",
    options: [
      "$y(x) = C\\,\\mathrm{e}^{2x}$, $C \\in \\mathbb{R}$",
      "$y(x) = 2x + C$, $C \\in \\mathbb{R}$",
      "$y(x) = C\\,\\mathrm{e}^{x}$, $C \\in \\mathbb{R}$",
      "$y(x) = x^2 + C$, $C \\in \\mathbb{R}$",
    ],
    correctAnswer: "0",
    points: 1,
    order: 9,
    tags: ["équations différentielles"],
    difficulty: 2,
    gradingRubric: {
      mode: { kind: "qcm", correctIndex: 0 },
      llmReviewRequired: false,
      weight: 1,
      detailedRubric: "$y' = ay \\Rightarrow y = C\\,\\mathrm{e}^{ax}$ avec $a = 2$.",
    },
  },

  // QCM 10 — Loi binomiale (espérance)
  {
    type: "qcm",
    question: "Une variable aléatoire $X$ suit la loi $\\mathcal{B}(5\\,;\\,0{,}3)$. L'espérance $\\mathrm{E}(X)$ est\u00a0:",
    options: ["$0{,}3$", "$1{,}5$", "$5$", "$1{,}05$"],
    correctAnswer: "1",
    points: 1,
    order: 10,
    tags: ["probabilités", "loi binomiale", "espérance"],
    difficulty: 1,
    gradingRubric: {
      mode: { kind: "qcm", correctIndex: 1 },
      llmReviewRequired: false,
      weight: 1,
      detailedRubric: "$\\mathrm{E}(X) = np = 5 \\times 0{,}3 = 1{,}5$.",
    },
  },

  // ========== RÉPONSES COURTES (5 questions, 2 points chacune) ==========

  // RC 11 — Limite de suite
  {
    type: "short_answer",
    question:
      "Déterminez la limite de la suite $(u_n)$ définie par $u_n = \\dfrac{2n + 3}{n + 1}$ quand $n \\to +\\infty$. Justifiez brièvement.",
    correctAnswer: "2",
    points: 2,
    order: 11,
    tags: ["suites", "limites"],
    difficulty: 1,
    gradingRubric: {
      mode: { kind: "numeric", value: 2, tolerance: 1e-12, relative: false },
      acceptableForms: ["2", "2.0", "2,0", "+2", "2/1"],
      llmReviewRequired: false,
      weight: 1,
      detailedRubric:
        "Diviser num. et dén. par $n$\u00a0: $\\dfrac{2 + 3/n}{1 + 1/n} \\to \\dfrac{2}{1} = 2$. Accepter toute valeur numérique égale à 2.",
    },
  },

  // RC 12 — Dérivation (composée)
  {
    type: "short_answer",
    question:
      "Soit $f$ la fonction définie sur $\\mathbb{R}$ par $f(x) = \\mathrm{e}^{2x} - 3x$. Déterminez $f'(x)$.",
    correctAnswer: "2*exp(2*x)-3",
    points: 2,
    order: 12,
    tags: ["dérivation", "fonction exponentielle"],
    difficulty: 2,
    gradingRubric: {
      mode: {
        kind: "symbolic",
        canonical: "2*exp(2*x) - 3",
        variables: ["x"],
      },
      acceptableForms: [
        "2exp(2x)-3",
        "2*exp(2*x)-3",
        "-3+2exp(2x)",
        "2e^(2x)-3",
        "2e^{2x}-3",
      ],
      llmReviewRequired: false,
      weight: 1,
      detailedRubric:
        "Dérivée de $\\mathrm{e}^{2x}$\u00a0: $2\\,\\mathrm{e}^{2x}$ (règle de la composée). Dérivée de $-3x$\u00a0: $-3$. Résultat\u00a0: $2\\,\\mathrm{e}^{2x} - 3$.",
    },
  },

  // RC 13 — Intégration (logarithme)
  {
    type: "short_answer",
    question:
      "Calculez l'intégrale $I = \\displaystyle\\int_1^2 \\dfrac{1}{x}\\,\\mathrm{d}x$. Donnez la valeur exacte.",
    correctAnswer: "log(2)",
    points: 2,
    order: 13,
    tags: ["intégration", "logarithme"],
    difficulty: 2,
    gradingRubric: {
      mode: {
        kind: "symbolic",
        canonical: "log(2)",
        variables: [],
      },
      acceptableForms: ["ln(2)", "log(2)", "ln2", "\\ln(2)", "\\ln 2"],
      llmReviewRequired: false,
      weight: 1,
      detailedRubric:
        "$\\displaystyle\\int_1^2 \\frac{1}{x}\\,\\mathrm{d}x = [\\ln x]_1^2 = \\ln 2 - \\ln 1 = \\ln 2$.",
    },
  },

  // RC 14 — Équation différentielle y' = −2y + 4
  {
    type: "short_answer",
    question:
      "Résolvez l'équation différentielle $y' = -2y + 4$ avec la condition initiale $y(0) = 1$. Donnez $y(x)$.",
    correctAnswer: "2-exp(-2*x)",
    points: 2,
    order: 14,
    tags: ["équations différentielles"],
    difficulty: 3,
    gradingRubric: {
      mode: {
        kind: "symbolic",
        canonical: "2 - exp(-2*x)",
        variables: ["x"],
      },
      acceptableForms: [
        "2-exp(-2*x)",
        "2-e^(-2x)",
        "-e^(-2x)+2",
        "2-e^{-2x}",
        "-\\mathrm{e}^{-2x}+2",
      ],
      llmReviewRequired: false,
      weight: 1,
      detailedRubric:
        "Solution générale\u00a0: $y = C\\,\\mathrm{e}^{-2x} + 2$. Condition initiale $y(0)=1$\u00a0: $C + 2 = 1 \\Rightarrow C = -1$. Donc $y(x) = 2 - \\mathrm{e}^{-2x}$.",
    },
  },

  // RC 15 — Probabilités (fraction irréductible)
  {
    type: "short_answer",
    question:
      "Une urne contient 5 boules rouges et 3 boules bleues, indiscernables au toucher. On tire successivement et avec remise 2 boules. Quelle est la probabilité d'obtenir deux boules de même couleur ? Donnez le résultat sous forme d'une fraction irréductible.",
    correctAnswer: "17/32",
    points: 2,
    order: 15,
    tags: ["probabilités", "dénombrement", "fraction"],
    difficulty: 2,
    gradingRubric: {
      mode: { kind: "fraction", numerator: 17, denominator: 32, reduced: true },
      acceptableForms: ["17/32"],
      llmReviewRequired: false,
      weight: 1,
      detailedRubric:
        "$P = \\left(\\dfrac{5}{8}\\right)^2 + \\left(\\dfrac{3}{8}\\right)^2 = \\dfrac{25}{64} + \\dfrac{9}{64} = \\dfrac{34}{64} = \\dfrac{17}{32}$. Pénalité 25\\% si fraction non irréductible ou forme décimale.",
    },
  },

  // ========== VRAI / FAUX avec justification (5 questions, 2 points chacune) ==========

  // VF 16 — Suites (théorème de convergence monotone)
  {
    type: "true_false",
    question: "Toute suite croissante et majorée converge.",
    correctAnswer: "true",
    justificationRequired: true,
    points: 2,
    order: 16,
    tags: ["suites", "convergence"],
    difficulty: 2,
    gradingRubric: {
      mode: { kind: "true_false", correctValue: "true" },
      llmReviewRequired: true,
      weight: 1,
      detailedRubric:
        "1 pt pour la réponse VRAI. 1 pt si la justification invoque le théorème de la limite monotone (suite croissante et majorée ⇒ converge vers sa borne supérieure).",
    },
  },

  // VF 17 — Dérivabilité implique continuité
  {
    type: "true_false",
    question:
      "Si une fonction $f$ est dérivable en un réel $a$, alors $f$ est continue en $a$.",
    correctAnswer: "true",
    justificationRequired: true,
    points: 2,
    order: 17,
    tags: ["dérivation", "continuité"],
    difficulty: 2,
    gradingRubric: {
      mode: { kind: "true_false", correctValue: "true" },
      llmReviewRequired: true,
      weight: 1,
      detailedRubric:
        "1 pt pour VRAI. 1 pt si la justification mentionne que la dérivabilité implique la continuité (la réciproque est fausse).",
    },
  },

  // VF 18 — Logarithme de somme
  {
    type: "true_false",
    question:
      "Pour tous réels $a > 0$ et $b > 0$, on a $\\ln(a + b) = \\ln(a) + \\ln(b)$.",
    correctAnswer: "false",
    justificationRequired: true,
    points: 2,
    order: 18,
    tags: ["logarithme", "propriétés"],
    difficulty: 1,
    gradingRubric: {
      mode: { kind: "true_false", correctValue: "false" },
      llmReviewRequired: true,
      weight: 1,
      detailedRubric:
        "1 pt pour FAUX. 1 pt si contre-exemple ou rappel de la vraie formule\u00a0: $\\ln(ab) = \\ln a + \\ln b \\neq \\ln(a+b)$.",
    },
  },

  // VF 19 — Intégrale de fonction positive
  {
    type: "true_false",
    // Correction pédagogique : préciser a < b (borne inférieure strictement inférieure)
    question:
      "Si $f$ est une fonction positive et continue sur $[a\\,;\\,b]$ avec $a < b$, alors $\\displaystyle\\int_a^b f(x)\\,\\mathrm{d}x \\geq 0$.",
    correctAnswer: "true",
    justificationRequired: true,
    points: 2,
    order: 19,
    tags: ["intégration", "positivité"],
    difficulty: 1,
    gradingRubric: {
      mode: { kind: "true_false", correctValue: "true" },
      llmReviewRequired: true,
      weight: 1,
      detailedRubric:
        "1 pt pour VRAI. 1 pt si justification\u00a0: $f \\geq 0$ sur $[a\\,;\\,b]$ avec $a<b$ implique $\\int_a^b f \\geq 0$ (positivité de l'intégrale).",
    },
  },

  // VF 20 — Variance de la loi binomiale
  {
    type: "true_false",
    question:
      "Si une variable aléatoire $X$ suit la loi $\\mathcal{B}(n,\\,p)$, alors sa variance est $V(X) = np$.",
    correctAnswer: "false",
    justificationRequired: true,
    points: 2,
    order: 20,
    tags: ["probabilités", "loi binomiale", "variance"],
    difficulty: 2,
    gradingRubric: {
      mode: { kind: "true_false", correctValue: "false" },
      llmReviewRequired: true,
      weight: 1,
      detailedRubric:
        "1 pt pour FAUX. 1 pt si justification\u00a0: $V(X) = np(1-p) \\neq np$ en général (sauf si $p = 0$). C'est l'espérance qui vaut $np$.",
    },
  },
];

export const MAX_SCORE = evaluationQuestions.reduce((sum, q) => sum + q.points, 0);
