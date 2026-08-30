import { env } from "../lib/env";
import { logger } from "../lib/logger";
import type { UserProfile } from "./types";

async function kimiRequest<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T | null> {
  const resp = await fetch(`${env.kimiOpenUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    // Passe par le journal structuré : ce message porte un identifiant de
    // requête, et la réponse du fournisseur est tronquée — elle peut contenir
    // le jeton refusé.
    logger.warn("[kimi] Appel refusé par la plateforme", {
      path,
      status: resp.status,
      reponse: text.slice(0, 200),
    });
    return null;
  }
  return resp.json() as Promise<T>;
}

export const users = {
  getProfile: (token: string) =>
    kimiRequest<UserProfile>("/v1/users/me/profile", token),
};
