/**
 * api/anticheat/fingerprint.ts
 *
 * Hash SHA-256 des composants browser côté serveur (Node crypto).
 * La sérialisation est partagée avec le client via contracts/fingerprint-canonical.ts.
 */
import { createHash } from "node:crypto";
import {
  FingerprintComponentsSchema,
  serializeCanonical,
  type FingerprintComponents,
} from "@contracts/fingerprint-canonical";

export { FingerprintComponentsSchema, type FingerprintComponents };

/**
 * Calcule le hash SHA-256 (hex 64 chars) à partir des composants validés.
 * Mode strict validé par Shark : tout changement d'environnement → hash différent.
 */
export function computeFingerprintHash(components: FingerprintComponents): string {
  const canonical = serializeCanonical(components);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Compare deux hashs. Mode strict : toute différence = mismatch.
 * Retourne aussi une raison textuelle pour le logging.
 */
export function compareFingerprints(
  stored: string,
  incoming: string,
): { match: boolean; reason: string } {
  if (stored === incoming) {
    return { match: true, reason: "Hash identique" };
  }
  return {
    match: false,
    reason: "Hash différent — changement d'environnement détecté",
  };
}
