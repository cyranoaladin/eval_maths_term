-- Migration 0003_anticheat.sql — Phase 3 : Anti-triche professionnel
-- Appliqué sur : sessions, cheat_events, + nouvelle table answer_drafts

-- 1. Métadonnées anti-triche sur sessions
ALTER TABLE sessions
  ADD COLUMN ipAddress VARCHAR(45) NULL AFTER studentEmail,
  ADD COLUMN userAgent TEXT NULL AFTER ipAddress,
  ADD COLUMN fingerprintHash VARCHAR(64) NULL AFTER userAgent,
  ADD COLUMN suspicionScore TINYINT UNSIGNED NULL DEFAULT 0 AFTER lastHeartbeatAt,
  ADD COLUMN suspicionVerdict ENUM('clean','minor','moderate','severe') NULL DEFAULT 'clean' AFTER suspicionScore,
  ADD INDEX idx_s_heartbeat (lastHeartbeatAt, status);

-- 2. Nouvelle valeur enum pour auto-submit sur idle
ALTER TABLE sessions
  MODIFY COLUMN status ENUM(
    'in_progress',
    'completed',
    'timed_out',
    'cheating_detected',
    'auto_submitted_idle'
  ) NOT NULL DEFAULT 'in_progress';

-- 3. Table des brouillons auto-save (séparée de responses qui est immuable après submit)
CREATE TABLE answer_drafts (
  sessionId  BIGINT UNSIGNED NOT NULL,
  questionId BIGINT UNSIGNED NOT NULL,
  answer     TEXT,
  justification TEXT,
  updatedAt  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  committedAt TIMESTAMP NULL,
  PRIMARY KEY (sessionId, questionId),
  CONSTRAINT fk_ad_session  FOREIGN KEY (sessionId)  REFERENCES sessions(id)  ON DELETE CASCADE,
  CONSTRAINT fk_ad_question FOREIGN KEY (questionId) REFERENCES questions(id) ON DELETE RESTRICT
);

-- 4. Étendre l'enum cheat_events.type avec les nouveaux types Phase 3
ALTER TABLE cheat_events
  MODIFY COLUMN type ENUM(
    'tab_switch',
    'blur',
    'context_menu',
    'copy',
    'paste',
    'fullscreen_exit',
    'print',
    'devtools_open',
    'fingerprint_mismatch',
    'multi_device',
    'prolonged_blur',
    'idle_disconnect',
    'window_size_anomaly'
  ) NOT NULL;
