/**
 * src/components/math/MathPalette.tsx
 *
 * Palette de symboles mathématiques pour aider la saisie dans MathInput.
 * Organised en groupes (fractions, exposants, fonctions, symboles grecs, probabilités).
 *
 * Utilisation :
 *   <MathPalette onInsert={(latex) => setAnswer(prev => prev + latex)} />
 *
 * Chaque bouton insère un fragment LaTeX au curseur (ou à la fin de la valeur).
 * L'apparence est minimaliste pour ne pas surcharger l'interface.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import MathLatex from "./MathLatex";

interface PaletteSymbol {
  label: string;
  latex: string;
  title: string;
}

interface PaletteGroup {
  name: string;
  symbols: PaletteSymbol[];
}

const PALETTE_GROUPS: PaletteGroup[] = [
  {
    name: "Fractions & racines",
    symbols: [
      { label: "\\frac{a}{b}", latex: "\\frac{}{}", title: "Fraction" },
      { label: "\\sqrt{x}", latex: "\\sqrt{}", title: "Racine carrée" },
      { label: "\\sqrt[n]{x}", latex: "\\sqrt[]{}", title: "Racine n-ième" },
    ],
  },
  {
    name: "Exposants & indices",
    symbols: [
      { label: "x^{n}", latex: "^{}", title: "Exposant" },
      { label: "x_{n}", latex: "_{}", title: "Indice" },
      { label: "x^{2}", latex: "^2", title: "Carré" },
      { label: "x^{-1}", latex: "^{-1}", title: "Inverse" },
    ],
  },
  {
    name: "Fonctions",
    symbols: [
      { label: "\\ln", latex: "\\ln", title: "Logarithme naturel" },
      { label: "\\log", latex: "\\log", title: "Logarithme décimal" },
      { label: "\\exp", latex: "\\exp", title: "Exponentielle" },
      { label: "e^{x}", latex: "e^{}", title: "e exposant" },
      { label: "\\sin", latex: "\\sin", title: "Sinus" },
      { label: "\\cos", latex: "\\cos", title: "Cosinus" },
      { label: "\\tan", latex: "\\tan", title: "Tangente" },
    ],
  },
  {
    name: "Symboles",
    symbols: [
      { label: "\\infty", latex: "\\infty", title: "Infini" },
      { label: "\\pi", latex: "\\pi", title: "Pi" },
      { label: "\\times", latex: "\\times", title: "Multiplication" },
      { label: "\\div", latex: "\\div", title: "Division" },
      { label: "\\pm", latex: "\\pm", title: "Plus ou moins" },
      { label: "\\neq", latex: "\\neq", title: "Différent" },
      { label: "\\leq", latex: "\\leq", title: "Inférieur ou égal" },
      { label: "\\geq", latex: "\\geq", title: "Supérieur ou égal" },
      { label: "\\approx", latex: "\\approx", title: "Environ" },
    ],
  },
  {
    name: "Intégrales & sommes",
    symbols: [
      {
        label: "\\int_a^b",
        latex: "\\int_{}^{}",
        title: "Intégrale définie",
      },
      { label: "\\sum", latex: "\\sum_{}^{}", title: "Somme" },
      { label: "\\lim", latex: "\\lim_{}", title: "Limite" },
      { label: "\\to", latex: "\\to", title: "Tend vers" },
    ],
  },
  {
    name: "Ensembles",
    symbols: [
      { label: "\\mathbb{R}", latex: "\\mathbb{R}", title: "Réels" },
      { label: "\\mathbb{N}", latex: "\\mathbb{N}", title: "Entiers naturels" },
      { label: "\\mathbb{Z}", latex: "\\mathbb{Z}", title: "Entiers relatifs" },
      { label: "\\in", latex: "\\in", title: "Appartient à" },
      { label: "\\notin", latex: "\\notin", title: "N'appartient pas à" },
      { label: "\\subset", latex: "\\subset", title: "Inclus dans" },
      { label: "\\cup", latex: "\\cup", title: "Union" },
      { label: "\\cap", latex: "\\cap", title: "Intersection" },
      { label: "\\emptyset", latex: "\\emptyset", title: "Ensemble vide" },
    ],
  },
];

interface MathPaletteProps {
  onInsert: (latex: string) => void;
  className?: string;
}

export function MathPalette({ onInsert, className }: MathPaletteProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(
    PALETTE_GROUPS[0].name,
  );

  return (
    <div
      className={cn(
        "w-full rounded-md border border-border bg-muted/30 p-2 text-sm",
        className,
      )}
      role="toolbar"
      aria-label="Palette de symboles mathématiques"
    >
      {/* Onglets de groupes */}
      <div className="flex flex-wrap gap-1 mb-2">
        {PALETTE_GROUPS.map((group) => (
          <button
            key={group.name}
            type="button"
            onClick={() =>
              setOpenGroup(openGroup === group.name ? null : group.name)
            }
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium transition-colors",
              openGroup === group.name
                ? "bg-primary text-primary-foreground"
                : "bg-background hover:bg-accent hover:text-accent-foreground",
            )}
            aria-pressed={openGroup === group.name}
          >
            {group.name}
          </button>
        ))}
      </div>

      {/* Grille de symboles du groupe actif */}
      {PALETTE_GROUPS.filter((g) => g.name === openGroup).map((group) => (
        <div
          key={group.name}
          className="flex flex-wrap gap-1"
          role="group"
          aria-label={group.name}
        >
          {group.symbols.map((sym) => (
            <button
              key={sym.latex}
              type="button"
              title={sym.title}
              aria-label={sym.title}
              onClick={() => onInsert(sym.latex)}
              className={cn(
                "inline-flex items-center justify-center",
                "h-9 min-w-[2.25rem] px-2",
                "rounded border border-border bg-background",
                "text-xs font-mono",
                "hover:bg-accent hover:text-accent-foreground",
                "active:scale-95 transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <MathLatex tex={sym.label} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export default MathPalette;
