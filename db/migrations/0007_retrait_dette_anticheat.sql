-- Retrait de deux colonnes que plus rien n'alimentait.
--
-- `sessions.cheatEvents` était un tableau JSON d'incidents de surveillance,
-- remplacé par la table `cheat_events` — indexée, contrainte, en ajout seul.
-- Elle portait « DROP prévu en v0.4.0 » depuis. `sessions.tabSwitchCount`,
-- lui, était écrit à zéro à la création d'une session et n'était jamais relu :
-- le compte se déduit de `cheat_events`.
--
-- Rien n'est perdu. Les incidents encore stockés dans la colonne JSON sont
-- d'abord recopiés dans `cheat_events` : ils peuvent fonder une décision de
-- l'établissement sur une copie, et une migration n'a pas à en décider.
--
-- La recopie est fail-closed : un type d'incident absent de l'énumération de
-- `cheat_events` fait échouer l'ordre, et la migration s'arrête avant le DROP.
-- C'est le comportement voulu — une valeur qu'on ne sait pas classer se règle
-- avec l'enseignant, pas dans un script de déploiement.
--
-- Contrôle préalable : npx tsx scripts/preflight-incidents-json.ts

INSERT INTO `cheat_events` (`sessionId`, `type`, `timestamp`)
SELECT s.`id`, j.`type`, j.`timestamp`
FROM `sessions` s,
     JSON_TABLE(
       s.`cheatEvents`,
       '$[*]' COLUMNS (
         `type` varchar(64) PATH '$.type',
         `timestamp` datetime PATH '$.timestamp'
       )
     ) AS j
WHERE s.`cheatEvents` IS NOT NULL
  AND JSON_LENGTH(s.`cheatEvents`) > 0;
--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `tabSwitchCount`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `cheatEvents`;
