import { authRouter } from "./auth-router";
import { evaluationRouter } from "./evaluation-router";
import { gradingRouter } from "./grading-router";
import { gradingRouter2 } from "./routers/grading-router";
import { sessionRouter } from "./routers/session-router";
import { questionRouter } from "./routers/question-router";
import { cheatRouter } from "./routers/cheat-router";
import { answerRouter } from "./routers/answer-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  evaluation: evaluationRouter,
  grading: gradingRouter,   // Phase 1 — conservé pour compatibilité
  grading2: gradingRouter2, // Phase 2 — moteur de correction complet
  session: sessionRouter,
  question: questionRouter,
  cheat: cheatRouter,
  answer: answerRouter,
});

export type AppRouter = typeof appRouter;
