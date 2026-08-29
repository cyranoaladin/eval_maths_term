-- Migration 0001 : FK, index, table cheat_events, colonnes de session
-- Phase 1 — Sécurité & intégrité

-- ========== Clés étrangères ==========

ALTER TABLE questions
  ADD CONSTRAINT fk_questions_evaluation
    FOREIGN KEY (evaluationId) REFERENCES evaluations(id) ON DELETE CASCADE;

ALTER TABLE sessions
  ADD CONSTRAINT fk_sessions_evaluation
    FOREIGN KEY (evaluationId) REFERENCES evaluations(id) ON DELETE RESTRICT;

ALTER TABLE responses
  ADD CONSTRAINT fk_responses_session
    FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_responses_question
    FOREIGN KEY (questionId) REFERENCES questions(id) ON DELETE RESTRICT;

-- ========== Index sur sessions ==========

ALTER TABLE sessions
  ADD INDEX idx_sessions_started (startedAt),
  ADD INDEX idx_sessions_status (status),
  ADD INDEX idx_sessions_eval (evaluationId);

-- ========== Index sur responses ==========

ALTER TABLE responses
  ADD INDEX idx_responses_session (sessionId);

-- ========== Nouvelles colonnes sur sessions ==========

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS expiresAt TIMESTAMP NULL AFTER endedAt,
  ADD COLUMN IF NOT EXISTS normalizedScore INT NULL AFTER maxScore,
  ADD COLUMN IF NOT EXISTS shuffleSeed VARCHAR(64) NULL AFTER timeSpent,
  ADD COLUMN IF NOT EXISTS resultsToken TEXT NULL AFTER shuffleSeed,
  ADD COLUMN IF NOT EXISTS lastHeartbeatAt TIMESTAMP NULL AFTER resultsToken;

-- Mise à jour du statut ENUM pour inclure auto_submit
ALTER TABLE sessions
  MODIFY COLUMN status ENUM('in_progress','completed','timed_out','auto_submit','cheating_detected')
    NOT NULL DEFAULT 'in_progress';

-- ========== Migration des rôles utilisateurs ==========
-- Les utilisateurs OAuth Kimi sont des enseignants
UPDATE users SET role = 'teacher' WHERE role = 'user';

-- Mise à jour du ENUM role pour inclure student/teacher/admin
ALTER TABLE users
  MODIFY COLUMN role ENUM('student','teacher','admin') NOT NULL DEFAULT 'teacher';

-- ========== Table cheat_events (append-only) ==========

CREATE TABLE IF NOT EXISTS cheat_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sessionId BIGINT UNSIGNED NOT NULL,
  type ENUM(
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
    'prolonged_blur'
  ) NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSON,
  PRIMARY KEY (id),
  INDEX idx_cheat_session (sessionId),
  CONSTRAINT fk_cheat_events_session
    FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
);
