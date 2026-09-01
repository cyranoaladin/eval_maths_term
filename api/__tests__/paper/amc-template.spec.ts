/**
 * Génération du document LaTeX AMC.
 *
 * Deux exigences dominent :
 * 1. Aucun mélange — sans quoi la saisie manuelle devient ininterprétable et
 *    la correspondance directe utilisée pour les copies papier note au hasard.
 * 2. Les énoncés sont du LaTeX inséré tel quel : les échapper casserait les
 *    formules, mais compiler du LaTeX arbitraire côté serveur doit rester sûr.
 */
import { describe, expect, it } from "vitest";
import {
  buildAmcDocument,
  LIMITES,
  assertSafeLatex,
  escapeLatexText,
  renderDisplayText,
  associationKey,
  UnsafeLatexError,
  type TemplateInput,
  type TemplateQuestion,
} from "../../paper/amc-template";

const QCM: TemplateQuestion = {
  id: 1,
  type: "qcm",
  question: "La limite de $f(x)=\\dfrac{3x^2}{x^2+5}$ en $+\\infty$ vaut :",
  options: ["$+\\infty$", "$0$", "$3$", "$\\dfrac{1}{5}$"],
  order: 1,
  points: 1,
  gradingRubric: { mode: { kind: "qcm", correctIndex: 2 }, llmReviewRequired: false, weight: 1 },
};

const VF: TemplateQuestion = {
  id: 2,
  type: "true_false",
  question: "Toute suite croissante et majorée converge.",
  options: null,
  order: 2,
  points: 2,
  gradingRubric: {
    mode: { kind: "true_false", correctValue: "true" },
    llmReviewRequired: false,
    weight: 2,
  },
};

const OUVERTE: TemplateQuestion = {
  id: 3,
  type: "short_answer",
  question: "Calculer $\\int_0^1 x\\,dx$.",
  options: null,
  order: 3,
  points: 2,
  gradingRubric: { mode: { kind: "exact" }, llmReviewRequired: false, weight: 2 },
};

function input(overrides: Partial<TemplateInput> = {}): TemplateInput {
  return {
    title: "QCM Automatismes",
    durationMinutes: 45,
    questions: [QCM, VF],
    students: [
      { id: 11, lastName: "DUPONT", firstName: "Marie" },
      { id: 12, lastName: "BEN ALI", firstName: "Youcef" },
    ],
    ...overrides,
  };
}

/** Attache des identifiants aux élèves d'un cas de test. */
const avecIds = (eleves: Array<{ lastName: string; firstName: string }>) =>
  eleves.map((e, i) => ({ id: i + 1, ...e }));

describe("structure du document", () => {
  it("produit un document complet et compilable en apparence", () => {
    const { tex } = buildAmcDocument(input());
    expect(tex).toContain("\\documentclass[a4paper]{article}");
    expect(tex).toContain("automultiplechoice");
    expect(tex).toContain("\\begin{document}");
    expect(tex).toContain("\\end{document}");
    expect(tex).toContain("\\AMCform");
  });

  it("émet une copie par élève, directement dans le document", () => {
    /*
      Plus de CSV intermédiaire : le serveur connaît les élèves, chaque copie
      est un bloc `\copiepour{clé}{nom}` généré directement. La clé
      d'association est l'identifiant machine, jamais le nom.
    */
    const { tex } = buildAmcDocument(input());
    expect(tex).not.toContain("\\csvreader");
    expect(tex).toContain("\\onecopy{1}");
    expect(tex).toContain("\\AMCassociation{#1}");
    expect(tex).toContain("\\copiepour{student-11}{DUPONT Marie}");
    expect(tex).toContain("\\copiepour{student-12}{BEN ALI Youcef}");
  });

  it("associe la copie à l'identifiant machine, pas au nom", () => {
    // L'identité logique d'une copie ne dépend pas du rendu Unicode d'un nom :
    // c'est cette clé, ASCII et stable, qu'une correction optique lirait.
    expect(associationKey({ id: 123 })).toBe("student-123");
    const { tex } = buildAmcDocument(
      input({ students: [{ id: 7, lastName: "بن علي", firstName: "محمد" }] }),
    );
    expect(tex).toContain("\\copiepour{student-7}{");
    // La clé ne contient jamais le nom.
    expect(tex).not.toMatch(/\\copiepour\{[^}]*محمد/u);
  });

  it("échappe le nom de l'élève avant de l'écrire dans le document", () => {
    /*
      Le nom est inséré dans le corps LaTeX : non échappé, une contre-oblique
      ou une accolade ferait échouer toute la composition. Éprouvé sur
      AMC 1.7.0 : chacune de ces formes échappées s'imprime bien comme le
      caractère d'origine.
    */
    const { tex } = buildAmcDocument(
      input({
        students: avecIds([
          { lastName: "Dupont & Fils", firstName: "Amina" },
          { lastName: "O'Neill \\textbf{gras}", firstName: "Bilel" },
          { lastName: "Coût 100%", firstName: "Chloé_M" },
        ]),
      }),
    );

    expect(tex).toContain("\\copiepour{student-1}{Dupont \\& Fils Amina}");
    expect(tex).toContain("\\copiepour{student-2}{O'Neill \\textbackslash{}textbf\\{gras\\} Bilel}");
    expect(tex).toContain("\\copiepour{student-3}{Coût 100\\% Chloé\\_M}");
  });

  it("conserve la feuille-réponses séparée", () => {
    const { tex } = buildAmcDocument(input());
    expect(tex).toContain("separateanswersheet");
    expect(tex).toContain("\\AMCformBegin");
    expect(tex).toContain("\\namefield");
  });
});

describe("aucun mélange", () => {
  it("n'appelle jamais shufflegroup", () => {
    const { tex } = buildAmcDocument(input());
    expect(tex).not.toContain("\\shufflegroup");
  });

  it("déclare les propositions en ordre conservé", () => {
    const { tex } = buildAmcDocument(input());
    // `[o]` désactive le mélange des réponses par AMC.
    expect(tex).toContain("\\begin{choices}[o]");
    expect(tex).not.toMatch(/\\begin\{choices\}(?!\[o\])/);
  });

  it("imprime les propositions dans l'ordre de la base", () => {
    const { tex } = buildAmcDocument(input());
    const bloc = tex.slice(tex.indexOf("q1"), tex.indexOf("q2"));
    const positions = QCM.options!.map((o) => bloc.indexOf(o));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("marque la bonne réponse au bon rang", () => {
    const { tex } = buildAmcDocument(input());
    const bloc = tex.slice(tex.indexOf("q1"), tex.indexOf("q2"));
    expect(bloc).toContain("\\correctchoice{$3$}");
    expect(bloc).toContain("\\wrongchoice{$+\\infty$}");
  });

  it("respecte l'ordre des questions même si la liste arrive désordonnée", () => {
    const { tex, includedQuestionIds } = buildAmcDocument(
      input({ questions: [VF, QCM] }),
    );
    expect(includedQuestionIds).toEqual([1, 2]);
    expect(tex.indexOf("q1")).toBeLessThan(tex.indexOf("q2"));
  });
});

describe("questions non grillables", () => {
  it("écarte les réponses courtes en disant pourquoi", () => {
    const r = buildAmcDocument(input({ questions: [QCM, VF, OUVERTE] }));
    expect(r.includedQuestionIds).toEqual([1, 2]);
    expect(r.excluded).toEqual([
      { id: 3, reason: "Réponse courte : non grillable, à corriger séparément." },
    ]);
  });

  it("écarte une question sans barème : la bonne réponse est inconnue", () => {
    const r = buildAmcDocument(input({ questions: [{ ...QCM, gradingRubric: null }] }));
    expect(r.includedQuestionIds).toEqual([]);
    expect(r.excluded[0].reason).toMatch(/Barème manquant/);
  });

  it("écarte un QCM à moins de deux propositions", () => {
    const r = buildAmcDocument(input({ questions: [{ ...QCM, options: ["$3$"] }] }));
    expect(r.excluded[0].reason).toMatch(/sans propositions/);
  });
});

describe("sûreté du LaTeX", () => {
  it("laisse passer les mathématiques", () => {
    expect(() =>
      assertSafeLatex("$\\dfrac{1}{2}$ et $\\mathbb{R}$ et $\\int_0^1$", 1),
    ).not.toThrow();
  });

  it("refuse les primitives d'exécution", () => {
    // `\write18` permet de lancer des commandes système à la compilation.
    for (const p of ["\\write18{rm -rf /}", "\\immediate\\openout1=x", "\\input{/etc/passwd}"]) {
      expect(() => assertSafeLatex(p, 7)).toThrow(UnsafeLatexError);
    }
  });

  it("refuse une sortie prématurée du document", () => {
    expect(() => assertSafeLatex("fin \\end{document} suite", 7)).toThrow(/interdit/);
  });

  it("nomme la question fautive", () => {
    try {
      assertSafeLatex("\\write18{id}", 42);
      expect.unreachable();
    } catch (e) {
      expect((e as UnsafeLatexError).questionId).toBe(42);
    }
  });

  it("contrôle aussi les propositions, pas seulement l'énoncé", () => {
    expect(() =>
      buildAmcDocument(input({ questions: [{ ...QCM, options: ["$1$", "\\input{secret}"] }] })),
    ).toThrow(UnsafeLatexError);
  });

  describe("bornes de composition", () => {
    /*
      Ces bornes existent pour une raison mesurée : sans elles, un enseignant
      authentifié peut faire échouer la composition d'une manière que personne
      ne sait lire. Un nom d'élève de 400 ko fait sortir pdfTeX sur
      « Unable to read an entire line---bufsize=200000 » — et AMC rend malgré
      tout un code de sortie nul, sans produire le moindre document.

      Elles bornent aussi ce qu'une donnée d'enseignant peut atteindre en
      taille, ce dont dépend l'analyse d'applicabilité de CVE-2026-13221
      (voir docs/VEX-CANDIDATES.md).
    */
    const eleve = (i: number) => ({ id: i + 1, lastName: `NOM${i}`, firstName: `Prenom${i}` });

    it("refuse une classe démesurée en nommant la borne", () => {
      const trop = Array.from({ length: LIMITES.eleves + 1 }, (_, i) => eleve(i));
      expect(() => buildAmcDocument(input({ students: trop }))).toThrow(
        /501 élèves.*500/s,
      );
    });

    it("accepte exactement la borne", () => {
      const pile = Array.from({ length: LIMITES.eleves }, (_, i) => eleve(i));
      expect(() => buildAmcDocument(input({ students: pile }))).not.toThrow();
    });

    it("refuse un nom d'élève qui déborderait le tampon du moteur TeX", () => {
      const long = "N".repeat(LIMITES.nomEleve + 1);
      expect(() =>
        buildAmcDocument(
          input({ students: [{ id: 1, lastName: long, firstName: "Amina" }] }),
        ),
      ).toThrow(/nom.*trop long/i);
    });

    it("refuse un énoncé démesuré en nommant la question", () => {
      const enonce = "x".repeat(LIMITES.enonce + 1);
      expect(() =>
        buildAmcDocument(input({ questions: [{ ...QCM, question: enonce }] })),
      ).toThrow(/question 1/i);
    });

    it("refuse un mot insécable démesuré : mesuré, le moteur XeTeX tombe ou boucle au-delà", () => {
      /*
        Mesuré sur XeTeX + AMC 1.7.0 : un mot sans espace de 1 000 caractères
        tue le moteur (erreur de segmentation), et de 1 100 à 2 000 il boucle
        sans fin — AMC rendant un code de sortie nul dans les deux cas. La
        borne coupe très au-dessous, en nommant la question.
      */
      const mot = "q".repeat(LIMITES.motInsecable + 1);
      expect(() =>
        buildAmcDocument(input({ questions: [{ ...QCM, question: `Voici ${mot}` }] })),
      ).toThrow(/sans espace/);
      // À la borne exacte, l'énoncé passe.
      const auRas = "q".repeat(LIMITES.motInsecable);
      expect(() =>
        buildAmcDocument(input({ questions: [{ ...QCM, question: `Voici ${auRas}` }] })),
      ).not.toThrow();
    });

    it("refuse une proposition démesurée", () => {
      const option = "y".repeat(LIMITES.proposition + 1);
      expect(() =>
        buildAmcDocument(input({ questions: [{ ...QCM, options: ["$1$", option] }] })),
      ).toThrow(/proposition/i);
    });

    it("refuse plus de propositions qu'AMC ne sait étiqueter", () => {
      const trop = Array.from({ length: LIMITES.propositionsParQuestion + 1 }, (_, i) => `c${i}`);
      expect(() =>
        buildAmcDocument(input({ questions: [{ ...QCM, options: trop }] })),
      ).toThrow(/proposition/i);
    });

    it("refuse un questionnaire démesuré", () => {
      const trop = Array.from({ length: LIMITES.questions + 1 }, (_, i) => ({
        ...QCM,
        id: i + 1,
        order: i + 1,
      }));
      expect(() => buildAmcDocument(input({ questions: trop }))).toThrow(/questions/i);
    });

    it("refuse un caractère hors répertoire en le nommant", () => {
      // Le répertoire couvre le latin et l'arabe ; le reste — ici du
      // sinogramme — est refusé par son nom, jamais remplacé ni supprimé.
      expect(() =>
        buildAmcDocument(
          input({ students: [{ id: 1, lastName: "東京", firstName: "Amina" }] }),
        ),
      ).toThrow(/U\+6771/);
    });

    it("accepte un nom en écriture arabe, et le compose en droite-à-gauche", () => {
      /*
        Le produit sert un lycée français de Tunis : « محمد بن علي » est une
        donnée légitime. Le nom est accepté, jamais translittéré, et son
        fragment arabe reçoit l'enveloppe de direction `\textarabic`
        (polyglossia). Rendu éprouvé pour de vrai — lettres jointes, ordre
        droite-à-gauche — par la matrice papier et sa preuve visuelle.
      */
      const { tex } = buildAmcDocument(
        input({ students: [{ id: 5, lastName: "بن علي", firstName: "محمد" }] }),
      );
      expect(tex).toContain("\\textarabic{بن علي محمد}");
    });

    it("compose un nom mixte latin/arabe, chaque écriture dans son sens", () => {
      const { tex } = buildAmcDocument(
        input({
          students: [{ id: 6, lastName: "Ben Salah", firstName: "Mohamed محمد" }],
        }),
      );
      // Seul le fragment arabe est enveloppé ; le latin reste hors de
      // l'enveloppe, dans l'ordre d'origine.
      expect(tex).toContain("Ben Salah Mohamed \\textarabic{محمد}");
    });

    it("refuse l'arabe dans un énoncé : du LaTeX brut ne reçoit pas d'enveloppe", () => {
      // Un énoncé est du LaTeX inséré tel quel : impossible d'y poser
      // automatiquement l'enveloppe de direction sans réécrire le LaTeX de
      // l'enseignant. Le refus est nommé, il désigne la question et le
      // caractère.
      expect(() =>
        buildAmcDocument(
          input({ questions: [{ ...QCM, question: "Traduire مرحبا." }] }),
        ),
      ).toThrow(/question 1/);
    });

    it("accepte tout le répertoire latin, la ponctuation et l'euro", () => {
      // Chacun de ces caractères a été composé pour de vrai avant d'être
      // autorisé ici : latin-1, Latin Extended-A et B, diacritique combinant,
      // apostrophe typographique, tiret cadratin, euro.
      expect(() =>
        buildAmcDocument(
          input({
            title: "Contrôle — l\u2019épreuve à 5 € : ñ, ł, ő, ș, e\u0301",
            students: [{ id: 1, lastName: "O\u2019Neill-Dupré", firstName: "Chloé" }],
          }),
        ),
      ).not.toThrow();
    });

    it("désigne la question quand le caractère vient d'un énoncé", () => {
      expect(() =>
        buildAmcDocument(input({ questions: [{ ...QCM, question: "Combien font 東 + 京 ?" }] })),
      ).toThrow(/question 1/);
    });

    it("refuse un titre démesuré", () => {
      expect(() =>
        buildAmcDocument(input({ title: "T".repeat(LIMITES.titre + 1) })),
      ).toThrow(/titre/i);
    });
  });

  it("échappe les textes qui ne sont pas du LaTeX", () => {
    expect(escapeLatexText("Maths & Physique 100% #1")).toBe(
      "Maths \\& Physique 100\\% \\#1",
    );
  });

  it("n'échappe pas ce qu'il vient lui-même d'écrire", () => {
    /*
      L'échappement se faisait en plusieurs passes : la contre-oblique devenait
      `\textbackslash{}`, puis la passe suivante échappait les accolades de ce
      remplacement. Un titre contenant une contre-oblique s'imprimait donc
      `\{}` au lieu de `\`. Une seule passe, et le problème disparaît.
    */
    expect(escapeLatexText("C:\\dossier")).toBe("C:\\textbackslash{}dossier");
    expect(escapeLatexText("a~b")).toBe("a\\textasciitilde{}b");
    expect(escapeLatexText("2^3")).toBe("2\\textasciicircum{}3");
    // Et les accolades que l'utilisateur a vraiment écrites, elles, sont bien
    // échappées.
    expect(escapeLatexText("{x}")).toBe("\\{x\\}");
  });

  it("replie les blancs d'un nom sur une seule espace, sans perdre un caractère", () => {
    /*
      Plus de CSV : le point-virgule et le guillemet n'ont plus rien à casser,
      ils s'impriment tels quels. Seuls les blancs — dont un saut de ligne
      accidentel d'une liste importée — sont repliés en une espace, pour que le
      nom tienne sur sa ligne d'affichage.
    */
    const { tex } = buildAmcDocument(
      input({ students: [{ id: 1, lastName: 'MARTIN; "Le"', firstName: "Anne\nB" }] }),
    );
    expect(tex).toContain('\\copiepour{student-1}{MARTIN; "Le" Anne B}');
  });

  describe("préparation du texte d'affichage", () => {
    it("normalise en NFC : un accent décomposé redevient sa forme composée", () => {
      // « e » + U+0301 et « é » sont la même donnée ; ils doivent produire le
      // même document.
      expect(renderDisplayText("Noe\u0308l")).toBe("Noël");
      expect(renderDisplayText("e\u0301")).toBe("é");
    });

    it("enveloppe chaque séquence arabe, espaces intérieurs compris", () => {
      expect(renderDisplayText("محمد بن علي")).toBe("\\textarabic{محمد بن علي}");
      // Le fragment médian d'un nom mixte est enveloppé seul, à sa place.
      expect(renderDisplayText("Mohamed محمد Ben Salah")).toBe(
        "Mohamed \\textarabic{محمد} Ben Salah",
      );
    });

    it("échappe avant d'envelopper : un nom arabe ne casse pas le LaTeX", () => {
      expect(renderDisplayText("محمد & علي")).toBe(
        "\\textarabic{محمد} \\& \\textarabic{علي}",
      );
    });
  });
});
