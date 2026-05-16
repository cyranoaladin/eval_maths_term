/**
 * api/grading/shuffle.ts
 *
 * Mélange déterministe basé sur mulberry32 (PRNG seedé 32 bits).
 * Choix : mulberry32 plutôt que xorshift car meilleure distribution
 * sur les petits ensembles (< 20 éléments). Simple, rapide, sans dépendance.
 *
 * Usage :
 * - shuffleDeterministic(questions, sessionSeed) → ordre des questions
 * - shuffleOptions(options, correctIndex, seed, questionId) → ordre + new correctIndex
 *
 * Important sécurité : le mapping inverse est toujours retourné pour permettre
 * au serveur de convertir l'index soumis par l'élève en index original.
 */

/**
 * mulberry32 : retourne un générateur [0, 1) à partir d'une graine 32 bits.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convertit une chaîne en graine 32 bits (FNV-1a 32 bits).
 */
export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Fisher-Yates seedé : retourne un nouveau tableau mélangé.
 * L'original n'est pas modifié.
 */
export function shuffleDeterministic<T>(items: T[], seed: string): T[] {
  const rng = mulberry32(seedFromString(seed));
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Mélange les options d'un QCM et retourne :
 * - options mélangées
 * - nouveau correctIndex (position du bon choix après mélange)
 * - mapping : mapping[newIndex] = oldIndex
 *
 * La graine est dérivée de la graine de session + l'id de la question,
 * pour que chaque question ait un mélange distinct.
 *
 * @example
 *   const { options, correctIndex, mapping } = shuffleOptions(
 *     ["A", "B", "C", "D"], 2, "sessionSeed123", 7
 *   );
 *   // Au submit, si l'élève répond newIndex k :
 *   // originalIndex = mapping[k]
 *   // isCorrect = mapping[k] === rubric.correctIndex
 */
export function shuffleOptions(
  options: string[],
  correctIndex: number,
  sessionSeed: string,
  questionId: number,
): { options: string[]; correctIndex: number; mapping: number[] } {
  // Indices originaux
  const indices = options.map((_, i) => i);
  // Graine dérivée question-spécifique
  const qSeed = `${sessionSeed}-q${questionId}`;
  const shuffledIndices = shuffleDeterministic(indices, qSeed);

  return {
    options: shuffledIndices.map((i) => options[i]),
    correctIndex: shuffledIndices.indexOf(correctIndex),
    mapping: shuffledIndices, // mapping[newIndex] = oldIndex
  };
}

/**
 * Convertit l'index soumis par l'élève (dans le QCM mélangé) en index original.
 * À appeler côté serveur au moment de la correction.
 */
export function resolveOriginalIndex(
  submittedIndex: number,
  mapping: number[],
): number {
  if (submittedIndex < 0 || submittedIndex >= mapping.length) {
    throw new Error(
      `Index soumis ${submittedIndex} hors limites (0–${mapping.length - 1})`,
    );
  }
  return mapping[submittedIndex];
}
