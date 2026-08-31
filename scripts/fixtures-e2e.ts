/**
 * scripts/fixtures-e2e.ts
 *
 * Jeu de données déterministe pour les tests navigateur et le développement.
 *
 * Les écrans de correction et de saisie papier travaillent sur un tirage :
 * sans tirage, ils ne montrent qu'un message d'erreur, et les tests qui les
 * traversaient ne prouvaient rien. Ils passaient pourtant — parce qu'une base
 * de développement finit toujours par contenir un tirage créé à la main, un
 * jour, par quelqu'un. Une base neuve les faisait échouer : la donnée dont ils
 * dépendaient n'était écrite nulle part.
 *
 * Ce script l'écrit. Il est idempotent : chaque objet est identifié par une
 * clé stable, et le relancer ne crée pas de doublon.
 *
 * Le tirage n'a pas de dossier AMC : aucun PDF n'a été imprimé, et c'est exact.
 * La grille de saisie n'en a pas besoin — elle travaille sur
 * `printedQuestionIds`, la liste des questions figées au tirage.
 *
 * Usage : npx tsx scripts/fixtures-e2e.ts
 */
import "dotenv/config";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { classes, evaluations, paperCopies, paperExams, questions, students, users } from "../db/schema";
import { EVALUATION_TITLE } from "../contracts/evaluation-data";

const UNION_ID = "dev-teacher";
const NOM_CLASSE = "Terminale Démonstration";
const LIBELLE_TIRAGE = "Tirage de démonstration";

/**
 * Une évaluation au titre volontairement long.
 *
 * Les écrans se testaient sur des libellés courts, et débordaient sur les vrais.
 * Un enseignant nomme ses évaluations comme il les annonce à sa classe :
 * « Devoir surveillé n° 3 — suites, limites et raisonnement par récurrence ».
 * C'est ce cas-là qui doit tenir dans une tablette, pas « Test ».
 */
const TITRE_LONG =
  "Devoir surveillé n° 3 — suites numériques, limites, " +
  "et raisonnement par récurrence (Terminale spécialité)";
const DESCRIPTION_LONGUE =
  "Épreuve de deux heures portant sur l'ensemble du chapitre : convergence, " +
  "théorème des gendarmes, suites définies par récurrence, et rédaction complète " +
  "d'une démonstration par récurrence avec initialisation et hérédité.";

/** Élèves fictifs. Accents, apostrophe et particule : de quoi éprouver l'affichage. */
const ELEVES = [
  { lastName: "Durand", firstName: "Léa" },
  { lastName: "N'Diaye", firstName: "Amadou" },
  { lastName: "De La Fontaine", firstName: "Jean-Baptiste" },
  { lastName: "Öztürk", firstName: "Elif" },
  { lastName: "Nguyễn", firstName: "Minh" },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusé : ce script écrit des données de démonstration.");
    process.exit(1);
  }
  const db = getDb();

  const [enseignant] = await db.select().from(users).where(eq(users.unionId, UNION_ID)).limit(1);
  if (!enseignant) {
    console.error(
      `Aucun utilisateur « ${UNION_ID} ». Lancez d'abord : npx tsx scripts/dev-session.ts`,
    );
    process.exit(1);
  }

  const [evaluation] = await db
    .select({ id: evaluations.id })
    .from(evaluations)
    .where(eq(evaluations.title, EVALUATION_TITLE))
    .limit(1);
  if (!evaluation) {
    console.error("Aucune évaluation de référence. Lancez d'abord : npx tsx db/seed.ts");
    process.exit(1);
  }

  // ── Classe ────────────────────────────────────────────────────────────────
  let [classe] = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.name, NOM_CLASSE), eq(classes.ownerId, enseignant.id)))
    .limit(1);
  if (!classe) {
    const [insere] = await db
      .insert(classes)
      .values({ name: NOM_CLASSE, ownerId: enseignant.id });
    classe = { id: Number(insere.insertId) };
  }

  // ── Élèves ────────────────────────────────────────────────────────────────
  const idsEleves: number[] = [];
  for (const eleve of ELEVES) {
    const [existant] = await db
      .select({ id: students.id })
      .from(students)
      .where(
        and(
          eq(students.classId, classe.id),
          eq(students.lastName, eleve.lastName),
          eq(students.firstName, eleve.firstName),
        ),
      )
      .limit(1);
    if (existant) {
      idsEleves.push(existant.id);
      continue;
    }
    const [insere] = await db.insert(students).values({ ...eleve, classId: classe.id });
    idsEleves.push(Number(insere.insertId));
  }

  // ── Tirage ────────────────────────────────────────────────────────────────
  // Seules les questions à choix sont grillables sur une feuille-réponses.
  const grillables = await db
    .select({ id: questions.id })
    .from(questions)
    .where(
      and(
        eq(questions.evaluationId, evaluation.id),
        inArray(questions.type, ["qcm", "true_false"]),
      ),
    )
    .orderBy(asc(questions.order));
  const imprimees = grillables.map((q) => q.id);

  let [tirage] = await db
    .select({ id: paperExams.id })
    .from(paperExams)
    .where(
      and(
        eq(paperExams.evaluationId, evaluation.id),
        eq(paperExams.classId, classe.id),
        eq(paperExams.label, LIBELLE_TIRAGE),
      ),
    )
    .limit(1);

  if (tirage) {
    await db
      .update(paperExams)
      .set({ printedQuestionIds: imprimees, status: "entering" })
      .where(eq(paperExams.id, tirage.id));
  } else {
    const [insere] = await db.insert(paperExams).values({
      evaluationId: evaluation.id,
      classId: classe.id,
      label: LIBELLE_TIRAGE,
      status: "entering",
      printedQuestionIds: imprimees,
      generatedAt: new Date(),
      createdById: enseignant.id,
    });
    tirage = { id: Number(insere.insertId) };
  }

  // ── Copies ────────────────────────────────────────────────────────────────
  // Aucune n'est saisie : c'est l'état dans lequel un enseignant prend le
  // paquet en main.
  let copiesCreees = 0;
  for (const [index, studentId] of idsEleves.entries()) {
    const [existante] = await db
      .select({ id: paperCopies.id })
      .from(paperCopies)
      .where(
        and(eq(paperCopies.paperExamId, tirage.id), eq(paperCopies.studentId, studentId)),
      )
      .limit(1);
    if (existante) continue;
    await db
      .insert(paperCopies)
      .values({ paperExamId: tirage.id, studentId, copyNumber: index + 1 });
    copiesCreees++;
  }

  // ── Une évaluation au libellé long ────────────────────────────────────────
  let [longue] = await db
    .select({ id: evaluations.id })
    .from(evaluations)
    .where(eq(evaluations.title, TITRE_LONG))
    .limit(1);
  if (!longue) {
    const [insere] = await db.insert(evaluations).values({
      title: TITRE_LONG,
      description: DESCRIPTION_LONGUE,
      duration: 120,
      isActive: true,
      ownerId: enseignant.id,
    });
    longue = { id: Number(insere.insertId) };
  }

  /*
    Deux évaluations d'une seule question, pour la régression visuelle.

    Les questions d'une copie sont mélangées à l'ouverture, avec une graine
    tirée par le serveur : deux sessions n'affichent pas la même question en
    premier. Une image de référence prise sur « la première question » comparait
    donc deux écrans différents. Une évaluation qui n'en contient qu'une lève
    l'ambiguïté — et c'est bien la mise en page d'un type de question que ces
    images protègent, pas le tirage au sort.
  */
  const uniques: Array<{ titre: string; question: Record<string, unknown> }> = [
    {
      titre: "Écran de référence — question à choix",
      question: {
        type: "qcm",
        question: "La limite de $f(x)=\\dfrac{3x^2-2x+1}{x^2+5}$ en $+\\infty$ vaut :",
        options: JSON.stringify(["$+\\infty$", "$0$", "$3$", "$\\dfrac{1}{5}$"]),
        correctAnswer: "2",
        points: 2,
        order: 1,
        gradingRubric: { mode: { kind: "qcm", correctIndex: 2 }, llmReviewRequired: false, weight: 2 },
      },
    },
    {
      titre: "Écran de référence — réponse courte",
      question: {
        type: "short_answer",
        question: "Calculer $\\displaystyle\\int_0^1 x^2\\,\\mathrm{d}x$. Donnez le résultat sous forme de fraction irréductible.",
        correctAnswer: "1/3",
        points: 3,
        order: 1,
        gradingRubric: {
          mode: { kind: "fraction", numerator: 1, denominator: 3, reduced: true },
          llmReviewRequired: false,
          weight: 3,
        },
      },
    },
  ];

  const referencesVisuelles: number[] = [];
  for (const u of uniques) {
    let [evaluationUnique] = await db
      .select({ id: evaluations.id })
      .from(evaluations)
      .where(eq(evaluations.title, u.titre))
      .limit(1);
    if (!evaluationUnique) {
      const [insere] = await db.insert(evaluations).values({
        title: u.titre,
        description: "Une seule question : sert de référence à la comparaison d'images.",
        duration: 30,
        isActive: true,
        ownerId: enseignant.id,
      });
      evaluationUnique = { id: Number(insere.insertId) };
    }
    const [dejaLa] = await db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.evaluationId, evaluationUnique.id))
      .limit(1);
    if (!dejaLa) {
      await db.insert(questions).values({
        ...u.question,
        evaluationId: evaluationUnique.id,
      } as never);
    }
    referencesVisuelles.push(evaluationUnique.id);
  }

  console.log(`Classe « ${NOM_CLASSE} » — ${idsEleves.length} élèves`);
  console.log(`Écrans de référence : évaluations #${referencesVisuelles.join(", #")}`);
  console.log(`Évaluation au libellé long #${longue.id}`);
  console.log(
    `Tirage #${tirage.id} — ${imprimees.length} questions imprimées, ${copiesCreees} copie(s) créée(s)`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("Échec :", e);
  process.exit(1);
});
