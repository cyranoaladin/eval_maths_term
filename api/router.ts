import { accessRouter } from "./routers/access-router";
import { authRouter } from "./auth-router";
import { authoringRouter } from "./routers/authoring-router";
import { evaluationRouter } from "./routers/evaluation-router";
import { gradingRouter2 } from "./routers/grading-router";
import { sessionRouter } from "./routers/session-router";
import { questionRouter } from "./routers/question-router";
import { paperRouter } from "./routers/paper-router";
import { cheatRouter } from "./routers/cheat-router";
import { answerRouter } from "./routers/answer-router";
import { teacherLiveRouter } from "./routers/teacher-live-router";
import { createRouter } from "./middleware";

/**
 * Les routeurs `evaluation` et `grading` d'origine ont été supprimés en
 * Phase 3.5 : ils exposaient en `publicQuery` les corrections, la soumission
 * et les résultats. Leurs usages légitimes vivent désormais dans
 * `routers/evaluation-router.ts` (catalogue + seed) et `routers/grading-router.ts`
 * (correction enseignant).
 */
export const appRouter = createRouter({
  auth: authRouter,
  access: accessRouter,
  evaluation: evaluationRouter,
  authoring: authoringRouter,
  grading2: gradingRouter2,
  session: sessionRouter,
  question: questionRouter,
  paper: paperRouter,
  cheat: cheatRouter,
  answer: answerRouter,
  teacherLive: teacherLiveRouter,
});

export type AppRouter = typeof appRouter;
