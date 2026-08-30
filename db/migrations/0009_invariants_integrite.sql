-- Trois invariants confiés à la base plutôt qu'au code.
--
-- Ce sont des règles qu'une vérification applicative ne peut pas tenir sous
-- concurrence : entre le SELECT qui constate et l'INSERT qui écrit, une
-- seconde requête passe. La base, elle, tranche.
--
--   1. Un élève n'a qu'une copie par tirage. Deux saisies concurrentes — un
--      enseignant qui valide deux fois, deux surveillants sur le même paquet —
--      produisaient deux lignes, donc deux notes pour un même élève sur une
--      même épreuve. Le relevé en comptait deux et la moyenne s'en trouvait
--      faussée, sans que rien ne le signale.
--
--   2. Une session corrigée n'appartient qu'à une copie : sans quoi la même
--      note pourrait être rattachée à deux élèves.
--
--   3. Une question occupe une place unique dans son évaluation. L'ordre décide
--      de la numérotation imprimée et de la grille de saisie ; deux questions à
--      la même place rendent la copie papier illisible. C'est aussi la clé par
--      laquelle le semis reconnaît ce qu'il a déjà écrit.
--
-- Aucune de ces trois n'efface quoi que ce soit. Si la base contient des
-- doublons, MySQL refuse l'ordre avec l'erreur 1062 et la migration s'arrête :
-- c'est le comportement voulu. Deux copies pour un même élève sont une
-- information — probablement le signe d'un incident de saisie — et leur sort se
-- décide avec l'enseignant, pas dans un script de déploiement.
--
-- Contrôle préalable : npx tsx scripts/preflight-invariants.ts

ALTER TABLE `paper_copies` ADD CONSTRAINT `uq_paper_copies_exam_eleve` UNIQUE(`paperExamId`,`studentId`);--> statement-breakpoint
ALTER TABLE `paper_copies` ADD CONSTRAINT `uq_paper_copies_session` UNIQUE(`sessionId`);--> statement-breakpoint
ALTER TABLE `questions` ADD CONSTRAINT `uq_questions_evaluation_ordre` UNIQUE(`evaluationId`,`order`);
