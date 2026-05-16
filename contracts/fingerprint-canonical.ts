/**
 * contracts/fingerprint-canonical.ts
 *
 * Sérialisation canonique partagée client/serveur.
 * L'ordre des clés est FIXE — toute modification casse les hashs existants.
 * Utilisé par api/anticheat/fingerprint.ts (Node crypto) ET
 * src/hooks/useFingerprint.ts (Web Crypto API).
 */
import { z } from "zod";

export const FingerprintComponentsSchema = z.object({
  userAgent:           z.string().max(500),
  language:            z.string().max(20),
  languages:           z.array(z.string().max(20)).max(10),
  screen: z.object({
    width:             z.number().int().positive(),
    height:            z.number().int().positive(),
    colorDepth:        z.number().int().positive(),
    devicePixelRatio:  z.number().positive(),
  }),
  timezone:            z.string().max(50),
  timezoneOffset:      z.number().int(),
  hardwareConcurrency: z.number().int().nonnegative().max(256),
  platform:            z.string().max(50),
  /** 8 hex chars (32 bits) — tronqué pour tolérer les micro-variations canvas */
  canvasHash:          z.string().length(8),
  webglRenderer:       z.string().max(200),
});

export type FingerprintComponents = z.infer<typeof FingerprintComponentsSchema>;

/**
 * Sérialise les composants dans un ordre canonique strict.
 * Identique côté client et serveur → même hash SHA-256.
 */
export function serializeCanonical(c: FingerprintComponents): string {
  return JSON.stringify({
    ua:   c.userAgent,
    lang: c.language,
    langs: c.languages.slice().sort(),
    s: `${c.screen.width}x${c.screen.height}x${c.screen.colorDepth}@${c.screen.devicePixelRatio}`,
    tz:   c.timezone,
    tzo:  c.timezoneOffset,
    hc:   c.hardwareConcurrency,
    pl:   c.platform,
    cv:   c.canvasHash,
    wgl:  c.webglRenderer,
  });
}
