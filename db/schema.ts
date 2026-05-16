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
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["student", "teacher", "admin"]).default("teacher").notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  order: int("order").notNull().default(0),
  imageUrl: text("imageUrl"), // optionnel
});

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
  status: mysqlEnum("status", ["in_progress", "completed", "timed_out", "auto_submit", "cheating_detected"]).default("in_progress").notNull(),
  // Note: tabSwitchCount est maintenant calculé depuis cheat_events — conservé pour compatibilité
  tabSwitchCount: int("tabSwitchCount").default(0).notNull(),
  // Note: cheatEvents JSON est déprécié — utiliser la table cheat_events
  cheatEvents: json("cheatEvents").$type<Array<{type: string, timestamp: string}>>(),
  totalScore: int("totalScore"),
  maxScore: int("maxScore"),
  normalizedScore: int("normalizedScore"), // note sur 20 (x100 pour éviter les décimales, /100 à l'affichage)
  timeSpent: int("timeSpent"), // en secondes
  shuffleSeed: varchar("shuffleSeed", { length: 64 }), // graine de mélange déterministe
  resultsToken: text("resultsToken"), // token de résultats émis après soumission
  lastHeartbeatAt: timestamp("lastHeartbeatAt"), // dernier heartbeat reçu
}, (t) => [
  index("idx_sessions_started").on(t.startedAt),
  index("idx_sessions_status").on(t.status),
  index("idx_sessions_eval").on(t.evaluationId),
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
  score: int("score"),
  maxScore: int("maxScore"),
  llmFeedback: text("llmFeedback"), // feedback de la LLM
  gradedAt: timestamp("gradedAt"),
}, (t) => [
  index("idx_responses_session").on(t.sessionId),
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
  ]).notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  metadata: json("metadata"), // ex: { count: 30, fromTabIndex: 0 }
}, (t) => [
  index("idx_cheat_session").on(t.sessionId),
]);

export type CheatEvent = typeof cheatEvents.$inferSelect;
export type InsertCheatEvent = typeof cheatEvents.$inferInsert;
