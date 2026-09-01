import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import type { StudentSessionPayload } from "./anticheat/session-token";
import { authenticateRequest } from "./kimi/auth";
import { estSaturationPool } from "./queries/connection";
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
  } catch (e) {
    /*
      L'authentification est facultative ici — un appel anonyme est légitime.
      Mais avaler TOUTES les erreurs mentait sous charge : quand la file du
      pool est pleine, la recherche du compte échoue par saturation, et le
      service répondait « Authentification requise » (401) à un utilisateur
      pourtant connecté. La saturation remonte : la couche HTTP la traduit en
      503 + Retry-After, ce qu'elle est.
    */
    if (estSaturationPool(e)) throw e;
  }
  return ctx;
}
