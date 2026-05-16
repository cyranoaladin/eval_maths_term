/**
 * api/grading/normalize.ts
 *
 * Normalise une expression mathématique élève avant comparaison.
 * Applique les règles dans un ordre précis pour éviter les interférences.
 * Trade-off : on préfère la robustesse à l'exhaustivité — un cas non reconnu
 * tombe dans le fallback LLM plutôt que de mal noter.
 */

export function normalizeExpression(s: string): string {
  return s
    // 1. Espaces blancs (y compris insécables U+00A0, U+202F, U+2009)
    .replace(/[\s\u00A0\u202F\u2009]+/g, "")
    // 2. Virgule décimale française → point (seulement entre deux chiffres)
    .replace(/(\d),(\d)/g, "$1.$2")
    // 3. Symboles de multiplication Unicode
    .replace(/×/g, "*")
    .replace(/·/g, "*")
    .replace(/∙/g, "*")
    // 4. Division Unicode
    .replace(/÷/g, "/")
    // 5. Constantes mathématiques Unicode et LaTeX
    .replace(/π/g, "pi")
    .replace(/\\pi\b/g, "pi")
    .replace(/∞/g, "Infinity")
    .replace(/\\infty\b/g, "Infinity")
    // 6. Exposants Unicode superscripts
    .replace(/⁰/g, "^0")
    .replace(/¹/g, "^1")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/⁴/g, "^4")
    .replace(/⁵/g, "^5")
    .replace(/⁶/g, "^6")
    .replace(/⁷/g, "^7")
    .replace(/⁸/g, "^8")
    .replace(/⁹/g, "^9")
    // 7. Racine carrée
    .replace(/√\(/g, "sqrt(")
    .replace(/√([a-zA-Z0-9])/g, "sqrt($1)")
    .replace(/\\sqrt\{([^{}]+)\}/g, "sqrt($1)")
    .replace(/\\sqrt\b/g, "sqrt")
    // 8. Fonctions LaTeX → notation mathjs
    // \mathrm et \operatorname d'abord pour que \mathrm{ln} → ln → log
    .replace(/\\mathrm\{([^{}]+)\}/g, "$1")
    .replace(/\\operatorname\{([^{}]+)\}/g, "$1")
    // IMPORTANT : traiter AVANT la multiplication implicite chiffre×lettre
    .replace(/\\ln(?=[^a-zA-Z]|$)/g, "log")  // mathjs : log() = logarithme naturel — matche avant chiffres aussi
    .replace(/\\log(?=[^a-zA-Z]|$)/g, "log10")
    .replace(/\\exp\b/g, "exp")
    .replace(/\\sin\b/g, "sin")
    .replace(/\\cos\b/g, "cos")
    .replace(/\\tan\b/g, "tan")
    .replace(/\\arcsin\b/g, "asin")
    .replace(/\\arccos\b/g, "acos")
    .replace(/\\arctan\b/g, "atan")
    // 8b. Fonctions sans backslash (ln, log usuel en FR)
    // \bln\b ne matche pas 'ln2' car '2' est \w — on utilise un lookahead plus large
    .replace(/\bln\(/g, "log(")
    .replace(/\bln(?=[^a-zA-Z]|$)/g, "log")  // ln sans parenthèse (ex: ln2, ln x, ln)
    // 9. Fractions LaTeX \frac{num}{den} et \dfrac{num}{den}
    // Gestion imbriquée à 1 niveau — pour les fractions imbriquées, le LLM prend le relais
    .replace(/\\d?frac\{([^{}]+)\}\{([^{}]+)\}/g, "(($1)/($2))")
    // 10. Exposants LaTeX avec accolades : x^{2} → x^(2)
    // Doit être AVANT la règle e^x pour que e^{2x} → e^(2x) → exp(2x)
    .replace(/\^\{([^{}]+)\}/g, "^($1)")
    // 11. Notation e^x ou e^(expr) → exp(x) — AVANT la multiplication implicite
    // Gère : e^x, e^(2x), e^(-2x), e^(2*x) mais PAS les noms de fonctions
    .replace(/(?<![a-zA-Z_])e\^(\(([^)]+)\)|([a-zA-Z0-9.]+))/g, (_, _g1, g2, g3) => `exp(${g2 ?? g3})`)
    // 12. Multiplication implicite : chiffre suivi de lettre ou parenthèse ouvrante
    // ex: 2x → 2*x, 3(x+1) → 3*(x+1)
    // ATTENTION : ne PAS faire lettre×lettre pour préserver sin, exp, log, etc.
    .replace(/(\d)([a-zA-Z(])/g, "$1*$2")
    // 13. Signe + explicite en tête (ex: +2 → 2)
    .replace(/^\+/, "")
    // 13b. Supprimer éventuels * parasites créés avant des exposants
    // ex: "*^" ne peut pas exister en mathjs
    .replace(/\*\^/g, "^")
    // 13c. log ou log10 suivi directement d'un chiffre → ajouter parenthèses
    // ex: log2 → log(2), log10 → log(10)
    // Important : log10(2) ne doit pas devenir log10((2)) — guard par \b
    .replace(/\blog10(\d)/g, "log10($1)")
    .replace(/\blog(\d)/g, "log($1)")
    // 14. Lowercase final — mathjs est case-sensitive pour les constantes (pi, e)
    // mais on lowercase tout sauf les noms de fonctions déjà en minuscule
    .toLowerCase();
}

/**
 * Variante qui normalise et retourne aussi un tableau des formes rejetées détectées.
 * Utilisée par l'orchestrateur pour signaler à l'élève les mauvaises notations.
 */
export function normalizeAndDetectRejected(
  s: string,
  rejectedPatterns: string[],
): { normalized: string; rejectedMatches: string[] } {
  const normalized = normalizeExpression(s);
  const rejectedMatches: string[] = [];
  for (const pat of rejectedPatterns) {
    try {
      if (new RegExp(pat).test(s)) {
        rejectedMatches.push(pat);
      }
    } catch {
      // Pattern regex invalide — ignorer silencieusement
    }
  }
  return { normalized, rejectedMatches };
}
