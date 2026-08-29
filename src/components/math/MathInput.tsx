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
  useState,
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
    mathliveLoadPromise = import("mathlive")
      .then((mathlive) => {
        // MathLive cherche ses polices à côté de son propre script, c'est-à-dire
        // dans un répertoire que ni le serveur de développement ni le bundle de
        // production ne servent : le champ tombait alors sur les polices
        // système et rendait les formules de travers. Elles sont copiées dans
        // `public/mathlive/fonts` et désignées explicitement.
        mathlive.MathfieldElement.fontsDirectory = "/mathlive/fonts";
        // Aucun retour sonore pendant une évaluation.
        mathlive.MathfieldElement.soundsDirectory = null;
      })
      .catch((e) => {
        console.error("[MathInput] Impossible de charger MathLive:", e);
        mathliveLoadPromise = null;
      });
  }
  return mathliveLoadPromise!;
}

/**
 * Lecture et écriture de la formule.
 *
 * `el.value` n'est utilisable qu'une fois le custom element défini. Tant qu'il
 * ne l'est pas, une affectation crée une propriété propre à l'instance qui
 * masque définitivement l'accesseur du prototype : le champ affiche bien la
 * saisie, mais `el.value` renvoie toujours la chaîne écrite avant l'upgrade —
 * autrement dit la réponse de l'élève n'atteint jamais React. On ne touche donc
 * au champ qu'une fois MathLive chargé, et on passe par `getValue`/`setValue`.
 */
function lireValeur(el: MathfieldElement): string {
  return typeof el.getValue === "function" ? el.getValue() : (el.value ?? "");
}

function ecrireValeur(el: MathfieldElement, latex: string): void {
  if (typeof el.setValue === "function") {
    el.setValue(latex, { suppressChangeNotifications: true });
  } else {
    el.value = latex;
  }
}

interface MathfieldElement extends HTMLElement {
  value: string;
  disabled: boolean;
  focus(): void;
  getValue?(): string;
  setValue?(latex: string, options?: { suppressChangeNotifications?: boolean }): void;
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
  const [pret, setPret] = useState(false);

  // Charger MathLive au montage
  useEffect(() => {
    let monte = true;
    loadMathLive().then(() => {
      if (monte) setPret(true);
    });
    return () => {
      monte = false;
    };
  }, []);

  // Synchroniser la valeur externe → champ, une fois le champ réellement défini.
  useEffect(() => {
    const el = fieldRef.current;
    if (!pret || !el) return;
    if (lireValeur(el) !== value) ecrireValeur(el, value);
  }, [value, pret]);

  // Écouter les changements du champ → appeler onChange
  const handleInput = useCallback(
    (e: Event) => {
      const el = e.target as MathfieldElement;
      const newValue = lireValeur(el);
      if (newValue !== value) {
        onChange(newValue);
      }
    },
    [onChange, value],
  );

  useEffect(() => {
    const el = fieldRef.current;
    if (!pret || !el) return;
    el.addEventListener("input", handleInput);
    return () => {
      el.removeEventListener("input", handleInput);
    };
  }, [handleInput, pret]);

  // disabled
  useEffect(() => {
    const el = fieldRef.current;
    if (pret && el) el.disabled = disabled;
  }, [disabled, pret]);

  // autoFocus
  useEffect(() => {
    if (autoFocus && pret && fieldRef.current) {
      setTimeout(() => fieldRef.current?.focus(), 50);
    }
  }, [autoFocus, pret]);

  return (
    <div
      className={cn(
        "relative w-full rounded-md border border-input bg-background ring-offset-background",
        "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {/*
        Le champ n'est monté qu'une fois MathLive chargé et configuré : c'est à
        la connexion du premier <math-field> que la bibliothèque résout le
        chemin de ses polices, et ce chemin doit déjà être le bon.
      */}
      {!pret ? (
        <div
          aria-hidden="true"
          style={{ minHeight: "2.5rem", padding: "0.5rem 0.75rem" }}
          className="text-sm text-muted-foreground"
        >
          {placeholder ?? ""}
        </div>
      ) : (
      /* @ts-expect-error — web component not typed in React by default */
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
      )}
    </div>
  );
}

export default MathInput;
