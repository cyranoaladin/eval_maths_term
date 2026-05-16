import { authRouter } from "./auth-router";
import { evaluationRouter } from "./evaluation-router";
import { gradingRouter } from "./grading-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  evaluation: evaluationRouter,
  grading: gradingRouter,
});

export type AppRouter = typeof appRouter;
