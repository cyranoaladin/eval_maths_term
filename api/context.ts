import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import type { StudentSessionPayload } from "./anticheat/session-token";
import { authenticateRequest } from "./kimi/auth";
import { currentRequestId } from "./lib/request-id";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
  studentSession?: StudentSessionPayload;
  /** Identifiant de la requête en cours, rattaché aux journaux et à l'audit. */
  requestId?: string;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = {
    req: opts.req,
    resHeaders: opts.resHeaders,
    requestId: currentRequestId(),
  };
  try {
    ctx.user = await authenticateRequest(opts.req.headers);
  } catch {
    // Authentication is optional here
  }
  return ctx;
}
