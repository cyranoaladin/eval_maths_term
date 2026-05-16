/**
 * src/components/math/MathInput.tsx
 *
 * Champ de saisie mathématique basé sur MathLive (mathlive@0.105).
 * Rend un <math-field> web component qui affiche une saisie LaTeX interactive.
 *
 * Props :
 *   value       - valeur LaTeX courante (contrôlé)
 *   onChange    - callback(latexValue: string)
 *   placeholder - texte de substitution quand vide
 *   disabled    - désactiver le champ
 *   autoFocus   - focus automatique
 *
 * Pièges gérés :
 * - MathLive est un web component — doit être importé dynamiquement (ESM, pas de SSR)
 * - L'import est lazy pour éviter de bloquer le bundle principal
 * - Ref sur l'élément HTMLElement avec type assertion (MathfieldElement)
 * - L'événement "input" de math-field émet une CustomEvent avec detail.value
 * - Tailwind reset peut casser les styles internes de MathLive — encapsulé dans un div
 */
import React, {
  useRef,
  useEffect,
  useCallback,
  type HTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

// Déclaration du web component pour TypeScript
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "math-field": React.DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          value?: string;
          readonly?: boolean;
          placeholder?: string;
        },
        HTMLElement
      >;
    }
  }
}

interface MathInputProps {
  value: string;
  onChange: (latex: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

/**
 * Import dynamique de MathLive pour éviter le chargement au démarrage.
 * Retourne une promesse qui se résout une seule fois.
 */
let mathliveLoadPromise: Promise<void> | null = null;
function loadMathLive(): Promise<void> {
  if (!mathliveLoadPromise) {
    mathliveLoadPromise = import("mathlive").then(() => {
      // L'import suffit à enregistrer le web component <math-field>
    }).catch((e) => {
      console.error("[MathInput] Impossible de charger MathLive:", e);
      mathliveLoadPromise = null;
    });
  }
  return mathliveLoadPromise!;
}

interface MathfieldElement extends HTMLElement {
  value: string;
  disabled: boolean;
  focus(): void;
}

export function MathInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  autoFocus = false,
  className,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: MathInputProps) {
  const fieldRef = useRef<MathfieldElement | null>(null);

  // Charger MathLive au montage
  useEffect(() => {
    loadMathLive();
  }, []);

  // Synchroniser la valeur externe → champ (évite la boucle infinie via ref guard)
  useEffect(() => {
    const el = fieldRef.current;
    if (el && el.value !== value) {
      el.value = value;
    }
  }, [value]);

  // Écouter les changements du champ → appeler onChange
  const handleInput = useCallback(
    (e: Event) => {
      const el = e.target as MathfieldElement;
      const newValue = el.value ?? "";
      if (newValue !== value) {
        onChange(newValue);
      }
    },
    [onChange, value],
  );

  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.addEventListener("input", handleInput);
    return () => {
      el.removeEventListener("input", handleInput);
    };
  }, [handleInput]);

  // disabled
  useEffect(() => {
    const el = fieldRef.current;
    if (el) el.disabled = disabled;
  }, [disabled]);

  // autoFocus
  useEffect(() => {
    if (autoFocus && fieldRef.current) {
      setTimeout(() => fieldRef.current?.focus(), 50);
    }
  }, [autoFocus]);

  return (
    <div
      className={cn(
        "relative w-full rounded-md border border-input bg-background ring-offset-background",
        "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {/* @ts-expect-error — web component not typed in React by default */}
      <math-field
        ref={fieldRef}
        id={id}
        aria-label={ariaLabel ?? "Saisie mathématique"}
        aria-describedby={ariaDescribedBy}
        placeholder={placeholder}
        style={{
          display: "block",
          width: "100%",
          minHeight: "2.5rem",
          padding: "0.5rem 0.75rem",
          fontSize: "1rem",
          outline: "none",
          border: "none",
          background: "transparent",
        }}
      />
    </div>
  );
}

export default MathInput;
