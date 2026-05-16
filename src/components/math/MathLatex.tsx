/**
 * src/components/math/MathLatex.tsx
 *
 * Composant de rendu LaTeX utilisant KaTeX.
 * Supporte les modes inline ($...$) et display ($$...$$).
 *
 * Utilisation :
 *   <MathLatex tex="\\frac{1}{2}" />                    → mode inline
 *   <MathLatex tex="\\int_0^1 x\\,dx" display />        → mode display (centré)
 *   <MathLatex tex="Soit $f(x) = x^2$, alors…" auto /> → parsing automatique
 *
 * Pièges gérés :
 * - KaTeX.renderToString peut throw → affichage du raw LaTeX avec style d'erreur
 * - Les délimiteurs $...$ et $$...$$ sont gérés par le mode "auto"
 * - SSR safe : katex est chargé uniquement côté client (dynamic import si besoin)
 */
import React, { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface MathLatexProps {
  /** Expression LaTeX pure (sans délimiteurs $ ou $$) */
  tex: string;
  /** Mode display : formule centrée sur sa propre ligne */
  display?: boolean;
  /**
   * Mode auto : analyse le texte et rend les portions $...$ inline
   * et $$...$$ en display. Le texte hors délimiteurs est rendu tel quel.
   */
  auto?: boolean;
  className?: string;
}

/**
 * Rend une expression LaTeX pure en HTML via KaTeX.
 * Retourne null en cas d'erreur (avec console.warn).
 */
function renderLatex(tex: string, displayMode: boolean): string | null {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: true,
      strict: false,
      trust: false,
    });
  } catch (e) {
    console.warn("[MathLatex] Erreur KaTeX:", e instanceof Error ? e.message : e, "| tex:", tex);
    return null;
  }
}

type TextPart =
  | { kind: "text"; content: string }
  | { kind: "math_inline"; content: string }
  | { kind: "math_display"; content: string };

/**
 * Parse une chaîne mixte texte + LaTeX délimité par $ et $$.
 */
function parseLatexString(input: string): TextPart[] {
  const parts: TextPart[] = [];
  let i = 0;

  while (i < input.length) {
    // Tenter display d'abord ($$)
    if (input[i] === "$" && input[i + 1] === "$") {
      const end = input.indexOf("$$", i + 2);
      if (end !== -1) {
        parts.push({ kind: "math_display", content: input.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    // Tenter inline ($)
    if (input[i] === "$") {
      const end = input.indexOf("$", i + 1);
      if (end !== -1) {
        parts.push({ kind: "math_inline", content: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Texte brut — accumuler jusqu'au prochain $
    const nextDollar = input.indexOf("$", i);
    if (nextDollar === -1) {
      parts.push({ kind: "text", content: input.slice(i) });
      break;
    }
    parts.push({ kind: "text", content: input.slice(i, nextDollar) });
    i = nextDollar;
  }

  return parts;
}

export function MathLatex({ tex, display = false, auto = false, className }: MathLatexProps) {
  const rendered = useMemo(() => {
    if (auto) {
      return parseLatexString(tex);
    }
    return null;
  }, [tex, auto]);

  // Mode direct (tex pur sans délimiteurs) — toujours appelé pour respecter l'ordre des hooks
  const directHtml = useMemo(
    () => (auto ? null : renderLatex(tex, display)),
    [tex, display, auto],
  );

  if (auto && rendered) {
    return (
      <span className={className}>
        {rendered.map((part, idx) => {
          if (part.kind === "text") {
            return <React.Fragment key={idx}>{part.content}</React.Fragment>;
          }
          const isDisplay = part.kind === "math_display";
          const html = renderLatex(part.content, isDisplay);
          if (html === null) {
            return (
              <code key={idx} className="text-red-500 text-xs font-mono">
                {isDisplay ? "$$" : "$"}{part.content}{isDisplay ? "$$" : "$"}
              </code>
            );
          }
          return (
            <span
              key={idx}
              dangerouslySetInnerHTML={{ __html: html }}
              aria-label={part.content}
            />
          );
        })}
      </span>
    );
  }

  const html = directHtml;

  if (html === null) {
    return (
      <code
        className={`text-red-500 text-xs font-mono ${className ?? ""}`}
        title="Erreur de rendu LaTeX"
      >
        {tex}
      </code>
    );
  }

  if (display) {
    return (
      <div
        className={`my-2 overflow-x-auto text-center ${className ?? ""}`}
        dangerouslySetInnerHTML={{ __html: html }}
        aria-label={tex}
      />
    );
  }

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
      aria-label={tex}
    />
  );
}

export default MathLatex;
