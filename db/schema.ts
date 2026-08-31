import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  int,
  json,
  boolean,
  bigint,
  index,
  decimal,
  tinyint,
  foreignKey,
  unique,
  primaryKey,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  /**
   * Le rôle ne vient jamais du client, et jamais du fournisseur OAuth : il est
   * décidé ici. Le défaut était `teacher` — n'importe qui capable d'ouvrir une
   * session Kimi devenait donc enseignant, sans que personne ne l'autorise.
   */
  role: mysqlEnum("role", ["student", "teacher", "admin"]).default("student").notNull(),
  /**
   * Autorisation d'accès, distincte du rôle.
   *
   * Un compte inconnu qui se connecte est créé `pending` : il existe, il est
   * visible d'un administrateur, et il n'ouvre rien. `disabled` révoque sans
   * effacer — un enseignant qui quitte l'établissement laisse derrière lui des
   * classes, des tirages et des notes dont il est l'auteur.
   */
  status: mysqlEnum("status", ["pending", "active", "disabled"])
    .default("pending")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Évaluations disponibles
export const evaluations = mysqlTable("evaluations", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  duration: int("duration").notNull(), // en minutes
  isActive: boolean("isActive").default(true).notNull(),
  /**
   * Phase 4 : une évaluation peut être passée en ligne, sur papier, ou les deux.
   * Le parcours en ligne (Phases 1 à 3) et le parcours papier (AMC) partagent
   * les mêmes questions, le même barème et le même moteur de correction.
   */
  deliveryMode: mysqlEnum("deliveryMode", ["online", "paper", "both"])
    .default("online")
    .notNull(),
  subject: varchar("subject", { length: 80 }),
  level: varchar("level", { length: 80 }),
  ownerId: bigint("ownerId", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  foreignKey({
    columns: [t.ownerId],
    foreignColumns: [users.id],
    name: "fk_evaluations_owner",
  }).onDelete("set null"),
]);

export type Evaluation = typeof evaluations.$inferSelect;
export type InsertEvaluation = typeof evaluations.$inferInsert;

// Questions d'une évaluation
export const questions = mysqlTable("questions", {
  id: serial("id").primaryKey(),
  evaluationId: bigint("evaluationId", { mode: "number", unsigned: true }).notNull(),
  type: mysqlEnum("type", ["qcm", "short_answer", "true_false"]).notNull(),
  question: text("question").notNull(),
  options: json("options"), // pour QCM: ["option1", "option2", ...]
  correctAnswer: text("correctAnswer").notNull(), // réponse correcte
  justificationRequired: boolean("justificationRequired").default(false), // pour Vrai/Faux
  points: int("points").notNull().default(1),
  // Phase 2 : rubric pédagogique — JAMAIS exposée au client
  gradingRubric: json("gradingRubric"),
  order: int("order").notNull().default(0),
  imageUrl: text("imageUrl"), // optionnel
  tags: json("tags").$type<string[]>(),
  difficulty: tinyint("difficulty", { unsigned: true }),
}, (t) => [
  foreignKey({
    columns: [t.evaluationId],
    foreignColumns: [evaluations.id],
    name: "fk_questions_evaluation",
  }).onDelete("cascade"),
  /**
   * Une place, une question.
   *
   * L'ordre décide de la numérotation imprimée et de la grille de saisie : deux
   * questions à la même place rendent la copie papier illisible. C'est aussi la
   * clé par laquelle le semis reconnaît ce qu'il a déjà écrit — sans contrainte,
   * deux semis concurrents dupliquent l'évaluation de référence.
   */
  unique("uq_questions_evaluation_ordre").on(t.evaluationId, t.order),
]);

export type Question = typeof questions.$inferSelect;
export type InsertQuestion = typeof questions.$inferInsert;

// Sessions d'évaluation (une session par élève)
export const sessions = mysqlTable("sessions", {
  id: serial("id").primaryKey(),
  evaluationId: bigint("evaluationId", { mode: "number", unsigned: true }).notNull(),
  studentName: varchar("studentName", { length: 255 }).notNull(),
  studentEmail: varchar("studentEmail", { length: 320 }),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  endedAt: timestamp("endedAt"),
  // Expiration calculée côté serveur (startedAt + durée + 30s de grâce)
  expiresAt: timestamp("expiresAt"),
  // Phase 3 metadata
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  fingerprintHash: varchar("fingerprintHash", { length: 64 }),
  status: mysqlEnum("status", ["in_progress", "completed", "timed_out", "cheating_detected", "auto_submitted_idle"]).default("in_progress").notNull(),
  /**
   * Nombre de réponses laissées à l'enseignant : barème absent, illisible, ou
   * correction assistée non aboutie.
   *
   * Écrit par le moteur, qui est le seul à le savoir. Il figurait dans la
   * réponse à la remise sans être conservé : une remise rejouée après une
   * coupure ne pouvait donc pas rendre la même réponse que la première.
   */
  needsManualReview: int("needsManualReview").default(0).notNull(),
  /** Somme des points obtenus — décimale pour la même raison que `responses.score`. */
  totalScore: decimal("totalScore", { precision: 7, scale: 2 }),
  maxScore: int("maxScore"),
  normalizedScore: decimal("normalizedScore", { precision: 5, scale: 2 }), // note sur 20 (ex: 19.75)
  timeSpent: int("timeSpent"), // en secondes
  shuffleSeed: varchar("shuffleSeed", { length: 64 }), // graine de mélange déterministe
  resultsToken: text("resultsToken"), // token de résultats émis après soumission
  lastHeartbeatAt: timestamp("lastHeartbeatAt"), // dernier heartbeat reçu
  suspicionScore: tinyint("suspicionScore", { unsigned: true }).default(0),
  suspicionVerdict: mysqlEnum("suspicionVerdict", ["clean", "minor", "moderate", "severe"]).default("clean"),
  /**
   * Phase 4 : origine de la copie.
   * - `online` : l'élève a composé dans le navigateur, les options ont été
   *   mélangées avec `shuffleSeed` ; l'index soumis doit être reconverti.
   * - `paper` : copie saisie par l'enseignant depuis un sujet imprimé, dans
   *   l'ordre d'origine des options ; l'index saisi est déjà le bon.
   * Distinguer les deux évite de deviner d'après la présence d'une graine.
   */
  mode: mysqlEnum("mode", ["online", "paper"]).default("online").notNull(),
}, (t) => [
  index("idx_sessions_started").on(t.startedAt),
  index("idx_sessions_status").on(t.status),
  index("idx_sessions_eval").on(t.evaluationId),
  // RESTRICT : on ne supprime pas une évaluation dont des copies existent.
  foreignKey({
    columns: [t.evaluationId],
    foreignColumns: [evaluations.id],
    name: "fk_sessions_evaluation",
  }).onDelete("restrict"),
]);

export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;

// Réponses des élèves
export const responses = mysqlTable("responses", {
  id: serial("id").primaryKey(),
  sessionId: bigint("sessionId", { mode: "number", unsigned: true }).notNull(),
  questionId: bigint("questionId", { mode: "number", unsigned: true }).notNull(),
  answer: text("answer").notNull(), // réponse de l'élève
  justification: text("justification"), // pour Vrai/Faux avec justification
  isCorrect: boolean("isCorrect"),
  /**
   * Points obtenus — décimal, pas entier : le moteur produit du crédit partiel
   * (fraction non réduite à 75 %, justification à moitié juste, note manuelle
   * au quart de point). Une colonne entière les arrondissait en silence.
   */
  score: decimal("score", { precision: 6, scale: 2 }),
  maxScore: int("maxScore"),
  llmFeedback: text("llmFeedback"), // feedback de la LLM
  // Phase 2 : métadonnées de correction
  gradingMode: varchar("gradingMode", { length: 20 }), // ex: "exact", "symbolic", "numeric", "llm"
  llmConfidence: decimal("llmConfidence", { precision: 3, scale: 2 }),
  gradingReason: text("gradingReason"),
  partialCreditApplied: boolean("partialCreditApplied").default(false).notNull(),
  gradedAt: timestamp("gradedAt"),
}, (t) => [
  index("idx_responses_session").on(t.sessionId),
  /**
   * Une copie ne peut pas porter deux réponses à la même question.
   *
   * Rien ne l'empêchait : la remise relisait chaque réponse avant d'écrire, et
   * deux appels concurrents pouvaient tous deux conclure à l'absence puis
   * insérer. Une copie de la base de développement en portait effectivement
   * deux, strictement identiques. La règle est désormais tenue par la base
   * elle-même, ce qui la rend aussi vraie sous concurrence.
   */
  unique("uq_responses_session_question").on(t.sessionId, t.questionId),
  foreignKey({
    columns: [t.sessionId],
    foreignColumns: [sessions.id],
    name: "fk_responses_session",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.questionId],
    foreignColumns: [questions.id],
    name: "fk_responses_question",
  }).onDelete("restrict"),
]);

export type Response = typeof responses.$inferSelect;
export type InsertResponse = typeof responses.$inferInsert;

/**
 * Événements de triche — append-only, jamais modifiés par le client.
 * Remplace la colonne JSON cheatEvents sur sessions (migrée progressivement).
 */
export const cheatEvents = mysqlTable("cheat_events", {
  id: serial("id").primaryKey(),
  sessionId: bigint("sessionId", { mode: "number", unsigned: true }).notNull(),
  type: mysqlEnum("type", [
    "tab_switch",
    "blur",
    "context_menu",
    "copy",
    "paste",
    "fullscreen_exit",
    "print",
    "devtools_open",
    "fingerprint_mismatch",
    "multi_device",
    "prolonged_blur",
    "idle_disconnect",
    "window_size_anomaly",
  ]).notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  metadata: json("metadata"), // ex: { count: 30, fromTabIndex: 0 }
}, (t) => [
  index("idx_cheat_session").on(t.sessionId),
  foreignKey({
    columns: [t.sessionId],
    foreignColumns: [sessions.id],
    name: "fk_cheat_events_session",
  }).onDelete("cascade"),
]);

export type CheatEvent = typeof cheatEvents.$inferSelect;
export type InsertCheatEvent = typeof cheatEvents.$inferInsert;
export type CheatEventType = CheatEvent["type"];

/**
 * Brouillons auto-save (Phase 3).
 * Séparés de `responses` qui sont immuables après submit.
 * committedAt IS NULL = brouillon actif ; IS NOT NULL = archivé (audit trail).
 */
export const answerDrafts = mysqlTable("answer_drafts", {
  sessionId: bigint("sessionId", { mode: "number", unsigned: true }).notNull(),
  questionId: bigint("questionId", { mode: "number", unsigned: true }).notNull(),
  answer: text("answer"),
  justification: text("justification"),
  /**
   * Version monotone produite par le client, par question.
   *
   * L'ordre d'arrivée ne dit rien de l'ordre de frappe : au retour du réseau,
   * la file hors ligne se vide pendant que l'élève écrit encore. Sans cette
   * version, un brouillon composé avant la coupure pouvait arriver après une
   * saisie plus récente et l'effacer.
   */
  clientVersion: bigint("clientVersion", { mode: "number", unsigned: true }).default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  committedAt: timestamp("committedAt"),
}, (t) => [
  // Un seul brouillon par (session, question) — l'upsert de `answer.saveDraft`
  // en dépend.
  primaryKey({ columns: [t.sessionId, t.questionId], name: "pk_answer_drafts" }),
  foreignKey({
    columns: [t.sessionId],
    foreignColumns: [sessions.id],
    name: "fk_answer_drafts_session",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.questionId],
    foreignColumns: [questions.id],
    name: "fk_answer_drafts_question",
  }).onDelete("cascade"),
]);

export type AnswerDraft = typeof answerDrafts.$inferSelect;
export type InsertAnswerDraft = typeof answerDrafts.$inferInsert;

// ─── Phase 4 : atelier enseignant ────────────────────────────────────────────

/** Classe / groupe d'élèves rattaché à un enseignant. */
export const classes = mysqlTable("classes", {
  id: serial("id").primaryKey(),
  ownerId: bigint("ownerId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 120 }).notNull(), // ex. « Terminale EDS G6 »
  level: varchar("level", { length: 80 }),           // ex. « Terminale »
  subject: varchar("subject", { length: 80 }),       // ex. « Mathématiques »
  schoolYear: varchar("schoolYear", { length: 16 }), // ex. « 2025-2026 »
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("idx_classes_owner").on(t.ownerId),
  foreignKey({
    columns: [t.ownerId],
    foreignColumns: [users.id],
    name: "fk_classes_owner",
  }).onDelete("cascade"),
]);

export type Class = typeof classes.$inferSelect;
export type InsertClass = typeof classes.$inferInsert;

/**
 * Élève d'une classe. Distinct de `sessions.studentName`, qui n'était qu'une
 * saisie libre : la saisie papier exige une liste nominative stable.
 */
export const students = mysqlTable("students", {
  id: serial("id").primaryKey(),
  classId: bigint("classId", { mode: "number", unsigned: true }).notNull(),
  lastName: varchar("lastName", { length: 120 }).notNull(),
  firstName: varchar("firstName", { length: 120 }).notNull(),
  email: varchar("email", { length: 320 }),
  /** Identifiant d'établissement ou numéro AMC, tel qu'importé du CSV. */
  externalId: varchar("externalId", { length: 64 }),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("idx_students_class").on(t.classId),
  foreignKey({
    columns: [t.classId],
    foreignColumns: [classes.id],
    name: "fk_students_class",
  }).onDelete("cascade"),
]);

export type Student = typeof students.$inferSelect;
export type InsertStudent = typeof students.$inferInsert;

/**
 * Un tirage papier : une évaluation imprimée pour une classe, à une date donnée.
 * Réimprimer pour une autre classe crée un second tirage, sans toucher au premier.
 */
export const paperExams = mysqlTable("paper_exams", {
  id: serial("id").primaryKey(),
  evaluationId: bigint("evaluationId", { mode: "number", unsigned: true }).notNull(),
  classId: bigint("classId", { mode: "number", unsigned: true }).notNull(),
  label: varchar("label", { length: 160 }),
  status: mysqlEnum("status", ["draft", "generated", "entering", "closed"])
    .default("draft")
    .notNull(),
  /** Dossier de travail AMC (sujet.tex, PDF, data/) relatif au répertoire de sortie. */
  workdir: varchar("workdir", { length: 255 }),
  /**
   * Questions effectivement grillées, dans l'ordre imprimé.
   * Figé au tirage : la grille de saisie doit refléter le papier que
   * l'enseignant a sous les yeux, pas l'état courant de l'évaluation.
   */
  printedQuestionIds: json("printedQuestionIds").$type<number[]>(),
  generatedAt: timestamp("generatedAt"),
  createdById: bigint("createdById", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("idx_paper_exams_eval").on(t.evaluationId),
  index("idx_paper_exams_class").on(t.classId),
  foreignKey({
    columns: [t.evaluationId],
    foreignColumns: [evaluations.id],
    name: "fk_paper_exams_evaluation",
  }).onDelete("restrict"),
  foreignKey({
    columns: [t.classId],
    foreignColumns: [classes.id],
    name: "fk_paper_exams_class",
  }).onDelete("restrict"),
  foreignKey({
    columns: [t.createdById],
    foreignColumns: [users.id],
    name: "fk_paper_exams_creator",
  }).onDelete("set null"),
]);

export type PaperExam = typeof paperExams.$inferSelect;
export type InsertPaperExam = typeof paperExams.$inferInsert;

/**
 * Copie papier d'un élève pour un tirage.
 * `sessionId` est renseigné à la saisie : la copie devient alors une session
 * `mode = 'paper'`, corrigée par le même moteur que les copies en ligne.
 */
export const paperCopies = mysqlTable("paper_copies", {
  id: serial("id").primaryKey(),
  paperExamId: bigint("paperExamId", { mode: "number", unsigned: true }).notNull(),
  studentId: bigint("studentId", { mode: "number", unsigned: true }).notNull(),
  /** Numéro de copie imprimé sur la feuille-réponses (numérotation AMC). */
  copyNumber: int("copyNumber"),
  sessionId: bigint("sessionId", { mode: "number", unsigned: true }),
  enteredAt: timestamp("enteredAt"),
  enteredById: bigint("enteredById", { mode: "number", unsigned: true }),
}, (t) => [
  index("idx_paper_copies_exam").on(t.paperExamId),
  foreignKey({
    columns: [t.paperExamId],
    foreignColumns: [paperExams.id],
    name: "fk_paper_copies_exam",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.studentId],
    foreignColumns: [students.id],
    name: "fk_paper_copies_student",
  }).onDelete("restrict"),
  foreignKey({
    columns: [t.sessionId],
    foreignColumns: [sessions.id],
    name: "fk_paper_copies_session",
  }).onDelete("set null"),
  /**
   * Un élève n'a qu'une copie par tirage.
   *
   * Deux saisies concurrentes de la même copie — l'enseignant qui valide deux
   * fois, deux surveillants qui saisissent le même paquet — produisaient deux
   * lignes, donc deux notes pour un même élève sur une même épreuve. Le relevé
   * en comptait deux, la moyenne s'en trouvait faussée, et rien ne le disait.
   */
  unique("uq_paper_copies_exam_eleve").on(t.paperExamId, t.studentId),
  /**
   * Une session corrigée n'appartient qu'à une copie. Sans cela, la même note
   * pourrait être rattachée à deux élèves.
   */
  unique("uq_paper_copies_session").on(t.sessionId),
]);

export type PaperCopy = typeof paperCopies.$inferSelect;
export type InsertPaperCopy = typeof paperCopies.$inferInsert;

/**
 * Journal des interventions sur les notes.
 *
 * Une note attribuée ou modifiée par un enseignant engage sa responsabilité :
 * il faut pouvoir répondre à « qui a changé cette note, quand, de combien, et
 * pourquoi ». Le journal est **append-only** : aucune route ne le modifie ni
 * ne le supprime.
 *
 * `actorEmail` est dénormalisé volontairement : si le compte enseignant
 * disparaît, la trace doit rester lisible.
 */
export const gradeAudit = mysqlTable("grade_audit", {
  id: serial("id").primaryKey(),
  sessionId: bigint("sessionId", { mode: "number", unsigned: true }).notNull(),
  /** Nul pour une action portant sur la copie entière (recorrection). */
  responseId: bigint("responseId", { mode: "number", unsigned: true }),
  questionId: bigint("questionId", { mode: "number", unsigned: true }),
  actorId: bigint("actorId", { mode: "number", unsigned: true }),
  actorEmail: varchar("actorEmail", { length: 320 }),
  action: mysqlEnum("action", ["manual_override", "manual_paper", "regrade"]).notNull(),
  oldScore: decimal("oldScore", { precision: 6, scale: 2 }),
  newScore: decimal("newScore", { precision: 6, scale: 2 }),
  oldMode: varchar("oldMode", { length: 24 }),
  newMode: varchar("newMode", { length: 24 }),
  reason: varchar("reason", { length: 500 }),
  requestId: varchar("requestId", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("idx_grade_audit_session").on(t.sessionId),
  index("idx_grade_audit_created").on(t.createdAt),
  foreignKey({
    columns: [t.sessionId],
    foreignColumns: [sessions.id],
    name: "fk_grade_audit_session",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.responseId],
    foreignColumns: [responses.id],
    name: "fk_grade_audit_response",
  }).onDelete("set null"),
  foreignKey({
    columns: [t.questionId],
    foreignColumns: [questions.id],
    name: "fk_grade_audit_question",
  }).onDelete("set null"),
  foreignKey({
    columns: [t.actorId],
    foreignColumns: [users.id],
    name: "fk_grade_audit_actor",
  }).onDelete("set null"),
]);

export type GradeAudit = typeof gradeAudit.$inferSelect;
export type InsertGradeAudit = typeof gradeAudit.$inferInsert;
