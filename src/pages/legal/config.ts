/**
 * src/pages/legal/config.ts
 *
 * Coordonnées de l'établissement, injectées à la construction.
 *
 * Une mention légale approximative vaut moins que pas de mention : si une
 * valeur manque, la page l'affiche comme à compléter plutôt que d'inventer un
 * nom d'éditeur ou une adresse de contact.
 */
export interface Coordonnees {
  etablissement: string | null;
  adresse: string | null;
  directeurPublication: string | null;
  contact: string | null;
  hebergeur: string | null;
}

export const coordonnees: Coordonnees = {
  etablissement: import.meta.env.VITE_ETABLISSEMENT || null,
  adresse: import.meta.env.VITE_ETABLISSEMENT_ADRESSE || null,
  directeurPublication: import.meta.env.VITE_DIRECTEUR_PUBLICATION || null,
  contact: import.meta.env.VITE_CONTACT_DONNEES || null,
  hebergeur: import.meta.env.VITE_HEBERGEUR || null,
};

export const aCompleter = Object.values(coordonnees).some((v) => v === null);
