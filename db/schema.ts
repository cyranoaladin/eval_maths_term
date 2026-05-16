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
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
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
  status: mysqlEnum("status", ["in_progress", "completed", "timed_out", "cheating_detected"]).default("in_progress").notNull(),
  tabSwitchCount: int("tabSwitchCount").default(0).notNull(),
  cheatEvents: json("cheatEvents").$type<Array<{type: string, timestamp: string}>>(),
  totalScore: int("totalScore"),
  maxScore: int("maxScore"),
  timeSpent: int("timeSpent"), // en secondes
});

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
});

export type Response = typeof responses.$inferSelect;
export type InsertResponse = typeof responses.$inferInsert;
