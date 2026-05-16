-- Migration 0002 : Enrichissement schéma pour le moteur de correction Phase 2
-- Branche : phase-2-grading

-- ========== Table questions : rubric pédagogique ==========

ALTER TABLE questions
  ADD COLUMN gradingRubric JSON NULL AFTER points,
  ADD COLUMN tags JSON NULL AFTER imageUrl,
  ADD COLUMN difficulty TINYINT UNSIGNED NULL AFTER tags;

-- ========== Table sessions : normalizedScore DECIMAL ==========
-- La colonne normalizedScore existante (INT) est remplacée par un DECIMAL(5,2)
-- permettant de stocker 19.75, 20.00, etc. directement sans multiplication par 100.

ALTER TABLE sessions
  MODIFY COLUMN normalizedScore DECIMAL(5,2) NULL;

-- ========== Table responses : métadonnées de correction ==========

ALTER TABLE responses
  ADD COLUMN gradingMode VARCHAR(20) NULL AFTER llmFeedback,
  ADD COLUMN llmConfidence DECIMAL(3,2) NULL AFTER gradingMode,
  ADD COLUMN gradingReason TEXT NULL AFTER llmConfidence,
  ADD COLUMN partialCreditApplied BOOLEAN NOT NULL DEFAULT FALSE AFTER gradingReason;

-- Index complémentaire sur responses pour le dashboard prof
ALTER TABLE responses
  ADD INDEX idx_responses_question (questionId);
