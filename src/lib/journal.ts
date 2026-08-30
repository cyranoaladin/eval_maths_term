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
 * là où on les lit. En production, ils restent silencieux : couvrir l'écran
 * d'un élève de messages techniques pendant une épreuve n'aide personne, et il
 * n'y a pas encore de collecteur pour les recevoir. C'est ce point unique qui
 * en accueillera un — sans qu'aucun appelant ne change.
 */

type NiveauJournal = "warn" | "error";

export interface EvenementJournal {
  niveau: NiveauJournal;
  message: string;
  cause?: unknown;
}

function emettre(evenement: EvenementJournal): void {
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
