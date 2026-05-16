import { authRouter } from "./auth-router";
import { evaluationRouter } from "./evaluation-router";
import { gradingRouter } from "./grading-router";
import { sessionRouter } from "./routers/session-router";
import { questionRouter } from "./routers/question-router";
import { cheatRouter } from "./routers/cheat-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  evaluation: evaluationRouter,
  grading: gradingRouter,
  session: sessionRouter,
  question: questionRouter,
  cheat: cheatRouter,
});

export type AppRouter = typeof appRouter;
