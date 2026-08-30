export const Session = {
  cookieName: "kimi_sid",
  /** III.7 : TTL réduit de 1 an à 12h */
  maxAgeMs: 12 * 60 * 60 * 1000,
} as const;

/**
 * III.6 : Cookie anti-CSRF pour le state OAuth.
 * Stocké en HttpOnly, SameSite=Lax, TTL 10 minutes.
 */
export const OAuthState = {
  cookieName: "kimi_oauth_state",
  maxAgeMs: 10 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentification requise",
  insufficientRole: "Droits insuffisants",
} as const;

/**
 * Chemins connus des deux côtés. « /login » était défini trois fois — ici,
 * dans `LOGIN_PATH` juste en dessous, et dans `src/const.ts` — pour une seule
 * page.
 */
export const Paths = {
  login: "/login",
  oauthCallback: "/api/oauth/callback",
} as const;
