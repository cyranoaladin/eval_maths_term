/**
 * src/components/math/MathInput.tsx
 *
 * Champ de saisie mathématique basé sur MathLive (mathlive@0.110).
 *
 * Props :
 *   value       - valeur LaTeX courante (contrôlé)
 *   onChange    - callback(latexValue: string)
 *   placeholder - texte de substitution quand vide
 *   disabled    - désactiver le champ
 *   autoFocus   - focus automatique
 *
 * Le champ n'est pas écrit en JSX. `<math-field>` est un élément personnalisé
 * que React ne connaît pas : l'écrire en balise obligerait à déclarer un espace
 * de noms JSX global et à faire taire le vérificateur de types sur la balise
 * elle-même. Il est donc construit avec le constructeur que MathLive exporte —
 * `MathfieldElement` — et inséré dans un hôte tenu par une ref. On y gagne le
 * type réel de la bibliothèque, et React n'a plus à réconcilier un élément
 * dont il ignore les propriétés.
 *
 * Autres pièges gérés :
 * - MathLive est un module ESM qui définit un élément personnalisé au
 *   chargement : import dynamique, une seule fois.
 * - Le répertoire des polices doit être fixé AVANT la première connexion d'un
 *   champ, sinon MathLive les cherche à côté de son propre script — là où ni le
 *   serveur de développement ni le bundle de production ne les servent — et les
 *   formules s'affichent de travers.
 * - Le reset Tailwind casse les styles internes de MathLive : le champ est
 *   encapsulé dans un div qui porte la bordure et l'anneau de focus.
 */
import { useRef, useState, useEffect, useCallback } from "react";
import type { MathfieldElement } from "mathlive";
import { cn } from "@/lib/utils";

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

type ModuleMathLive = typeof import("mathlive");

/**
 * Import dynamique de MathLive pour éviter le chargement au démarrage.
 * Retourne une promesse résolue une seule fois pour toute l'application.
 */
let chargement: Promise<ModuleMathLive> | null = null;
function chargerMathLive(): Promise<ModuleMathLive> {
  if (!chargement) {
    chargement = import("mathlive").then((mathlive) => {
      mathlive.MathfieldElement.fontsDirectory = "/mathlive/fonts";
      // Aucun retour sonore pendant une évaluation.
      mathlive.MathfieldElement.soundsDirectory = null;
      return mathlive;
    });
    chargement.catch(() => {
      // Une seule tentative échouée ne doit pas condamner le champ pour la
      // durée de la page : la promesse est relâchée pour permettre un nouvel
      // essai au prochain montage.
      chargement = null;
    });
  }
  return chargement;
}

const STYLE_CHAMP: Partial<CSSStyleDeclaration> = {
  display: "block",
  width: "100%",
  minHeight: "2.5rem",
  padding: "0.5rem 0.75rem",
  fontSize: "1rem",
  outline: "none",
  border: "none",
  background: "transparent",
};

/**
 * Donne un nom au puits de saisie caché dans le shadow DOM de MathLive.
 *
 * C'est lui qui reçoit les frappes, et c'est donc lui qu'un lecteur d'écran
 * annonce. MathLive ne lui recopie pas le nom du champ hôte : l'élève
 * n'entendait qu'« édition de texte », sans savoir de quelle question. On le
 * pose nous-mêmes — c'est notre champ, et personne d'autre ne le fera.
 */
function nommerLePuits(champ: MathfieldElement, nom: string): void {
  const puits = champ.shadowRoot?.querySelector(".ML__keyboard-sink");
  puits?.setAttribute("aria-label", nom);
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
  const hoteRef = useRef<HTMLDivElement | null>(null);
  const champRef = useRef<MathfieldElement | null>(null);
  const [pret, setPret] = useState(false);

  // La valeur et le callback les plus récents, pour que la construction du
  // champ n'ait pas à se rejouer à chaque frappe. Mis à jour dans un effet
  // déclaré en premier : il s'exécute avant les autres du même composant.
  const valeurRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valeurRef.current = value;
    onChangeRef.current = onChange;
    ariaRef.current = {
      label: ariaLabel ?? "Saisie mathématique",
      id,
      describedBy: ariaDescribedBy,
      placeholder,
    };
  });

  /**
   * Dernière valeur que le champ a lui-même produite.
   *
   * Sans cette mémoire, une frappe rapide perd des caractères. L'élève tape
   * « 1 », le champ prévient React, mais l'état ne s'applique pas dans la même
   * frappe ; il tape « / », et le rendu déclenché par le « 1 » arrive avec une
   * valeur d'un temps de retard. La synchronisation « externe » constate alors
   * un écart et réécrit le champ — effaçant le « / » qui venait d'être frappé.
   * Un élève qui compose vite voyait sa réponse se rétracter sous ses doigts.
   *
   * On ne réécrit donc le champ que pour une valeur qui ne vient pas de lui :
   * la restauration d'un brouillon, ou le passage à une autre question.
   */
  const derniereValeurEmise = useRef<string | null>(null);

  /** Les attributs d'accessibilité, disponibles dès la construction du champ. */
  const ariaRef = useRef({
    label: ariaLabel ?? "Saisie mathématique",
    id,
    describedBy: ariaDescribedBy,
    placeholder,
  });

  // Construction du champ, une fois MathLive chargé.
  useEffect(() => {
    let monte = true;
    chargerMathLive().then(({ MathfieldElement }) => {
      const hote = hoteRef.current;
      if (!monte || !hote) return;

      const champ = new MathfieldElement();
      Object.assign(champ.style, STYLE_CHAMP);

      /*
        Le nom accessible est posé avant l'insertion dans la page. MathLive le
        recopie sur le puits de saisie caché de son shadow DOM au moment où il
        se connecte : posé après, le champ reste un « textbox » sans nom pour
        un lecteur d'écran.
      */
      champ.setAttribute("aria-label", ariaRef.current.label);
      if (ariaRef.current.id) champ.id = ariaRef.current.id;
      if (ariaRef.current.describedBy) {
        champ.setAttribute("aria-describedby", ariaRef.current.describedBy);
      }
      /*
        Pas de `placeholder` sur le champ.

        MathLive le rend en gris fixe — 1,87 contre 1 sur fond blanc, là où le
        seuil est 4,5 — et cette couleur n'est atteignable ni par les variables
        qu'il expose, ni par une règle CSS extérieure : elle est posée à
        l'intérieur de son shadow DOM. Un texte de substitution illisible ne
        renseigne personne. L'étiquette « Votre réponse : » est juste au-dessus,
        le nom accessible est porté par le champ, et la ligne d'aide sous le
        champ dit ce qu'on peut écrire.
      */

      champ.setValue(valeurRef.current, { silenceNotifications: true });
      champ.addEventListener("input", () => {
        const lue = champ.getValue();
        if (lue === valeurRef.current) return;
        derniereValeurEmise.current = lue;
        onChangeRef.current(lue);
      });

      hote.appendChild(champ);
      nommerLePuits(champ, ariaRef.current.label);
      champRef.current = champ;
      setPret(true);
    });

    return () => {
      monte = false;
      champRef.current?.remove();
      champRef.current = null;
    };
  }, []);

  // Attributs d'accessibilité et texte de substitution.
  useEffect(() => {
    const champ = champRef.current;
    if (!pret || !champ) return;
    const nom = ariaLabel ?? "Saisie mathématique";
    champ.setAttribute("aria-label", nom);
    nommerLePuits(champ, nom);
    if (id) champ.id = id;
    if (ariaDescribedBy) champ.setAttribute("aria-describedby", ariaDescribedBy);
    else champ.removeAttribute("aria-describedby");
  }, [pret, id, ariaLabel, ariaDescribedBy]);

  // Synchronisation d'une valeur venue d'ailleurs → champ.
  useEffect(() => {
    const champ = champRef.current;
    if (!pret || !champ) return;
    // C'est notre propre frappe qui nous revient, peut-être en retard : ne pas
    // y toucher, le champ est déjà en avance sur elle.
    if (value === derniereValeurEmise.current) return;
    if (champ.getValue() !== value) {
      champ.setValue(value, { silenceNotifications: true });
      derniereValeurEmise.current = null;
    }
  }, [value, pret]);

  useEffect(() => {
    const champ = champRef.current;
    if (pret && champ) champ.disabled = disabled;
  }, [disabled, pret]);

  const focaliser = useCallback(() => champRef.current?.focus(), []);
  useEffect(() => {
    if (autoFocus && pret) focaliser();
  }, [autoFocus, pret, focaliser]);

  return (
    <div
      className={cn(
        "relative w-full rounded-md border border-input bg-background ring-offset-background",
        "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <div ref={hoteRef} />
      {!pret && (
        <div
          aria-hidden="true"
          style={{ minHeight: "2.5rem", padding: "0.5rem 0.75rem" }}
          className="text-sm text-muted-foreground"
        >
          {placeholder ?? ""}
        </div>
      )}
    </div>
  );
}
