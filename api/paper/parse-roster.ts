/**
 * api/paper/parse-roster.ts
 *
 * Lecture d'une liste d'élèves exportée depuis un logiciel de vie scolaire.
 *
 * Le format observé (`QCM_EDS_MATHS_TERM/liste_eleves.csv`) : séparateur
 * point-virgule, valeurs entre guillemets, première colonne `Eleves` contenant
 * « NOM Prénom », et un BOM en tête de fichier.
 *
 * Séparer nom et prénom est ambigu — « BEN ALI YOUCEF » n'a pas de frontière
 * évidente. Convention retenue : tout sauf le dernier mot forme le nom, le
 * dernier mot le prénom. C'est le cas majoritaire des listes françaises, et
 * l'enseignant peut corriger ensuite.
 */
export interface ParsedStudent {
  lastName: string;
  firstName: string;
  email?: string;
}

export interface ParseResult {
  students: ParsedStudent[];
  /** Lignes ignorées, avec leur motif. */
  skipped: Array<{ line: number; reason: string }>;
  separator: string;
  nameColumn: string;
}

const COLONNES_NOM = ["eleves", "élèves", "eleve", "élève", "nom", "name", "nom prenom"];
const COLONNES_PRENOM = ["prenom", "prénom", "firstname"];
const COLONNES_EMAIL = ["adresse e-mail", "email", "e-mail", "mail"];

function detectSeparator(header: string): string {
  const pv = (header.match(/;/g) ?? []).length;
  const vg = (header.match(/,/g) ?? []).length;
  const tab = (header.match(/\t/g) ?? []).length;
  if (tab > pv && tab > vg) return "\t";
  return pv >= vg ? ";" : ",";
}

function splitLine(line: string, sep: string): string[] {
  const champs: string[] = [];
  let courant = "";
  let entreGuillemets = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (entreGuillemets && line[i + 1] === '"') {
        courant += '"';
        i++;
      } else {
        entreGuillemets = !entreGuillemets;
      }
    } else if (c === sep && !entreGuillemets) {
      champs.push(courant.trim());
      courant = "";
    } else {
      courant += c;
    }
  }
  champs.push(courant.trim());
  return champs;
}

/** « BEN ALI YOUCEF » → { lastName: "BEN ALI", firstName: "YOUCEF" } */
export function splitFullName(full: string): ParsedStudent {
  const mots = full.trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return { lastName: "", firstName: "" };
  if (mots.length === 1) return { lastName: mots[0], firstName: "" };
  return {
    lastName: mots.slice(0, -1).join(" "),
    firstName: mots[mots.length - 1],
  };
}

export function parseRoster(csv: string): ParseResult {
  // Le BOM se colle au premier nom de colonne et fait rater la détection.
  const contenu = csv.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lignes = contenu.split("\n").filter((l) => l.trim().length > 0);

  if (lignes.length < 2) {
    return { students: [], skipped: [{ line: 1, reason: "Fichier vide ou sans données" }], separator: ";", nameColumn: "" };
  }

  const separator = detectSeparator(lignes[0]);
  const entetes = splitLine(lignes[0], separator).map((h) => h.toLowerCase().trim());

  const iNom = entetes.findIndex((h) => COLONNES_NOM.includes(h));
  const iPrenom = entetes.findIndex((h) => COLONNES_PRENOM.includes(h));
  const iEmail = entetes.findIndex((h) => COLONNES_EMAIL.includes(h));

  if (iNom === -1) {
    return {
      students: [],
      skipped: [{ line: 1, reason: `Aucune colonne de nom reconnue parmi : ${entetes.join(", ")}` }],
      separator,
      nameColumn: "",
    };
  }

  const students: ParsedStudent[] = [];
  const skipped: Array<{ line: number; reason: string }> = [];
  const vus = new Set<string>();

  for (let i = 1; i < lignes.length; i++) {
    const champs = splitLine(lignes[i], separator);
    const brut = (champs[iNom] ?? "").trim();

    if (!brut) {
      skipped.push({ line: i + 1, reason: "Nom vide" });
      continue;
    }

    const eleve =
      iPrenom >= 0 && champs[iPrenom]
        ? { lastName: brut, firstName: champs[iPrenom].trim() }
        : splitFullName(brut);

    const cle = `${eleve.lastName}|${eleve.firstName}`.toLowerCase();
    if (vus.has(cle)) {
      skipped.push({ line: i + 1, reason: `Doublon : ${brut}` });
      continue;
    }
    vus.add(cle);

    const email = iEmail >= 0 ? champs[iEmail]?.trim() : undefined;
    students.push({ ...eleve, email: email || undefined });
  }

  return { students, skipped, separator, nameColumn: entetes[iNom] };
}
