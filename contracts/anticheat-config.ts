/**
 * contracts/anticheat-config.ts
 *
 * Paramètres pédagogiques anti-triche — ajustables sans toucher au code de calcul.
 * Validé par Shark : mode strict (false-positives acceptés en contexte examen).
 */
import type { CheatEventType } from "@db/schema";

export interface EventWeight {
  /** Score ajouté par occurrence */
  unit: number;
  /** Contribution maximale de ce type (plafond individuel) */
  cap: number;
}

/**
 * Pondérations par type d'événement.
 * Score final = min(100, Σ min(cap, count * unit)).
 */
export const EVENT_WEIGHTS: Record<CheatEventType, EventWeight> = {
  tab_switch:           { unit: 8,  cap: 40 },
  blur:                 { unit: 3,  cap: 15 },
  copy:                 { unit: 5,  cap: 30 },
  paste:                { unit: 5,  cap: 30 },
  context_menu:         { unit: 2,  cap: 10 },
  fullscreen_exit:      { unit: 10, cap: 30 },
  print:                { unit: 15, cap: 15 },
  devtools_open:        { unit: 50, cap: 50 },
  fingerprint_mismatch: { unit: 60, cap: 60 },
  multi_device:         { unit: 80, cap: 80 },
  prolonged_blur:       { unit: 5,  cap: 25 },
  idle_disconnect:      { unit: 20, cap: 20 },
  window_size_anomaly:  { unit: 15, cap: 30 },
};

/** Seuils de verdict (score final 0–100) */
export const VERDICT_THRESHOLDS = {
  clean:    0,
  minor:    15,
  moderate: 40,
  severe:   70,
} as const;

/** Fenêtre de coalescing côté serveur (ms) */
export const SERVER_COALESCE_WINDOW_MS = 500;

/** Seuil idle → alerte (ms sans heartbeat) */
export const IDLE_THRESHOLD_MS = 60_000;

/** Seuil idle → auto-submit (ms sans heartbeat) */
export const AUTO_SUBMIT_THRESHOLD_MS = 180_000;
