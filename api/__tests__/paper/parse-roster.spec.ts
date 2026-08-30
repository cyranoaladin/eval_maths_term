/**
 * Lecture des listes d'élèves.
 * Le format de référence est celui exporté par la vie scolaire du lycée :
 * point-virgule, guillemets, BOM, et « NOM Prénom » en une seule colonne.
 */
import { describe, expect, it } from "vitest";
import { parseRoster, splitFullName } from "../../paper/parse-roster";

const REEL = `\uFEFFEleves;Encouragement/Valorisation;Né(e) le;Sexe;Adresse E-mail;Classe
"ABID YOUCEF";"";"01/02/2008";"Masculin";"youcef.abid-e@ert.tn";"T.01"
"AGREBI SANDRA-INES";"";"21/10/2008";"Féminin";"sandraines.agrebi-e@ert.tn";"T.01"
"BEN ALI MOHAMED AMINE";"";"12/03/2008";"Masculin";"amine.benali-e@ert.tn";"T.08"`;

describe("format réel de la vie scolaire", () => {
  it("lit le fichier malgré le BOM et les guillemets", () => {
    const r = parseRoster(REEL);
    expect(r.separator).toBe(";");
    expect(r.nameColumn).toBe("eleves");
    expect(r.students).toHaveLength(3);
    expect(r.skipped).toEqual([]);
  });

  it("sépare nom et prénom en gardant les noms composés", () => {
    const r = parseRoster(REEL);
    expect(r.students[0]).toMatchObject({ lastName: "ABID", firstName: "YOUCEF" });
    // Le nom peut compter plusieurs mots : seul le dernier est le prénom.
    expect(r.students[2]).toMatchObject({
      lastName: "BEN ALI MOHAMED",
      firstName: "AMINE",
    });
  });

  it("récupère l'adresse quand la colonne existe", () => {
    const r = parseRoster(REEL);
    expect(r.students[0].email).toBe("youcef.abid-e@ert.tn");
  });
});

describe("autres formats", () => {
  it("accepte le séparateur virgule", () => {
    const r = parseRoster("Nom,Prenom\nDUPONT,Marie\nMARTIN,Paul");
    expect(r.separator).toBe(",");
    expect(r.students).toEqual([
      { lastName: "DUPONT", firstName: "Marie", email: undefined },
      { lastName: "MARTIN", firstName: "Paul", email: undefined },
    ]);
  });

  it("accepte une liste collée depuis un tableur, séparée par des tabulations", () => {
    // Un enseignant qui copie sa liste depuis Excel obtient des tabulations,
    // pas des points-virgules.
    const r = parseRoster("nom\tprenom\tclasse\nBenkhelifa\tAïcha\tT.01\nZidane\tYasmine\tT.01");

    expect(r.separator).toBe("\t");
    expect(r.students).toEqual([
      { lastName: "Benkhelifa", firstName: "Aïcha", email: undefined },
      { lastName: "Zidane", firstName: "Yasmine", email: undefined },
    ]);
  });

  it("rend son guillemet à un nom qui en contient", () => {
    // La convention CSV double le guillemet à l'intérieur d'un champ cité.
    const r = parseRoster('nom;prenom\n"D""Angelo";"Marie"\n');

    expect(r.students).toHaveLength(1);
    expect(r.students[0].lastName).toBe('D"Angelo');
  });

  it("ne bute pas sur une ligne plus courte que ses en-têtes", () => {
    // Une ligne tronquée par un export partiel : la colonne du nom n'existe
    // pas sur cette ligne-là. Elle est signalée, pas devinée.
    const r = parseRoster("classe;nom;prenom\nT.01\nT.01;Nour;Sami\n");

    expect(r.students).toEqual([{ lastName: "Nour", firstName: "Sami", email: undefined }]);
    expect(r.skipped).toEqual([{ line: 2, reason: "Nom vide" }]);
  });

  it("accepte des colonnes nom et prénom séparées", () => {
    const r = parseRoster("nom;prénom\nBEN ALI;Youcef");
    expect(r.students[0]).toMatchObject({ lastName: "BEN ALI", firstName: "Youcef" });
  });

  it("accepte les fins de ligne Windows", () => {
    const r = parseRoster("Nom\r\nDUPONT Marie\r\nMARTIN Paul\r\n");
    expect(r.students).toHaveLength(2);
  });
});

describe("lignes écartées", () => {
  it("signale les doublons au lieu de les insérer deux fois", () => {
    const r = parseRoster("Eleves\nDUPONT Marie\nDUPONT Marie");
    expect(r.students).toHaveLength(1);
    expect(r.skipped[0].reason).toMatch(/Doublon/);
  });

  it("signale les noms vides avec leur numéro de ligne", () => {
    const r = parseRoster('Eleves;Classe\n"";"T.01"\n"DUPONT Marie";"T.01"');
    expect(r.students).toHaveLength(1);
    expect(r.skipped).toEqual([{ line: 2, reason: "Nom vide" }]);
  });

  it("explique quand aucune colonne de nom n'est reconnue", () => {
    const r = parseRoster("identifiant;classe\n123;T.01");
    expect(r.students).toEqual([]);
    expect(r.skipped[0].reason).toMatch(/Aucune colonne de nom reconnue/);
  });

  it("gère un fichier vide", () => {
    expect(parseRoster("").students).toEqual([]);
  });
});

describe("splitFullName", () => {
  it("traite les cas limites", () => {
    expect(splitFullName("DUPONT Marie")).toEqual({ lastName: "DUPONT", firstName: "Marie" });
    expect(splitFullName("CHER")).toEqual({ lastName: "CHER", firstName: "" });
    expect(splitFullName("  DE  LA  TOUR  Jean  ")).toEqual({
      lastName: "DE LA TOUR",
      firstName: "Jean",
    });
    expect(splitFullName("")).toEqual({ lastName: "", firstName: "" });
  });
});
