/**
 * src/lib/journal.ts
 *
 * Journal du navigateur.
 *
 * Le code appelait `console.warn` et `console.error` directement. Deux
 * conséquences : côté produit, une anomalie survenue chez un élève ne laissait
 * aucune trace qu'on puisse consulter — la console d'un navigateur d'élève n'est
 * lue par personne ; côté tests, les parcours navigateur échouent sur toute
 * erreur de console inattendue, si bien qu'une erreur *attendue* et signalée
 * proprement à l'utilisateur devenait indiscernable d'un défaut.
 *
 * Les messages passent donc par ici. En développement, ils vont à la console,
 * là où on les lit. En production, ils sont remis au collecteur d'erreurs quand
 * il est branché, et restent silencieux sinon : couvrir un écran d'élève de
 * messages techniques pendant une épreuve n'aide personne.
 */

export type NiveauJournal = "warn" | "error";

export interface EvenementJournal {
  niveau: NiveauJournal;
  message: string;
  cause?: unknown;
}

type Collecteur = (evenement: EvenementJournal) => void;

let collecteur: Collecteur | null = null;

/**
 * Branche un collecteur — supervision d'erreurs, ou un double dans les tests.
 * Renvoie de quoi le débrancher.
 */
export function brancherCollecteur(nouveau: Collecteur): () => void {
  const precedent = collecteur;
  collecteur = nouveau;
  return () => {
    collecteur = precedent;
  };
}

function emettre(evenement: EvenementJournal): void {
  if (collecteur) {
    try {
      collecteur(evenement);
    } catch {
      // Un collecteur défaillant ne doit pas emporter l'application avec lui.
    }
    return;
  }

  if (import.meta.env.DEV) {
    const ligne = `[${evenement.niveau}] ${evenement.message}`;
    if (evenement.niveau === "error") console.error(ligne, evenement.cause ?? "");
    else console.warn(ligne, evenement.cause ?? "");
  }
}

export const journal = {
  warn(message: string, cause?: unknown) {
    emettre({ niveau: "warn", message, cause });
  },
  error(message: string, cause?: unknown) {
    emettre({ niveau: "error", message, cause });
  },
};
