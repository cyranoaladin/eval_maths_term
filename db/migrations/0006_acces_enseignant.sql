-- Un compte OAuth inconnu n'ouvre plus l'accès enseignant.
--
-- `users.role` avait `teacher` pour valeur par défaut. Toute personne capable
-- d'ouvrir une session chez le fournisseur OAuth devenait donc enseignante à sa
-- première connexion — sans que personne ne l'autorise, et sans que rien ne le
-- signale. L'autorisation devient explicite : le rôle par défaut est `student`,
-- et une colonne `status` dit si le compte est autorisé à s'en servir.
--
-- Cette migration ne retire l'accès à personne. Les comptes existants
-- l'avaient déjà ; les basculer en `pending` verrouillerait l'établissement
-- hors de son propre outil. Ils sont marqués `active` avec le rôle qu'ils
-- portent. Ce qui change, c'est la suite : le prochain inconnu qui se connecte
-- est créé `student` / `pending`, et un administrateur devra l'autoriser.
--
-- Contrôle préalable : npx tsx scripts/preflight-acces-enseignant.ts
--   il énumère les comptes qui vont être considérés comme autorisés, pour
--   qu'aucun ne le soit à l'insu de l'établissement.

ALTER TABLE `users` MODIFY COLUMN `role` enum('student','teacher','admin') NOT NULL DEFAULT 'student';--> statement-breakpoint
ALTER TABLE `users` ADD `status` enum('pending','active','disabled') DEFAULT 'pending' NOT NULL;--> statement-breakpoint
-- Les comptes déjà présents gardent l'accès qu'ils avaient.
UPDATE `users` SET `status` = 'active';
