CREATE TABLE `classes` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`ownerId` bigint unsigned NOT NULL,
	`name` varchar(120) NOT NULL,
	`level` varchar(80),
	`subject` varchar(80),
	`schoolYear` varchar(16),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `classes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `paper_copies` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`paperExamId` bigint unsigned NOT NULL,
	`studentId` bigint unsigned NOT NULL,
	`copyNumber` int,
	`sessionId` bigint unsigned,
	`enteredAt` timestamp,
	`enteredById` bigint unsigned,
	CONSTRAINT `paper_copies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `paper_exams` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`evaluationId` bigint unsigned NOT NULL,
	`classId` bigint unsigned NOT NULL,
	`label` varchar(160),
	`status` enum('draft','generated','entering','closed') NOT NULL DEFAULT 'draft',
	`workdir` varchar(255),
	`generatedAt` timestamp,
	`createdById` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `paper_exams_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`classId` bigint unsigned NOT NULL,
	`lastName` varchar(120) NOT NULL,
	`firstName` varchar(120) NOT NULL,
	`email` varchar(320),
	`externalId` varchar(64),
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `students_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `evaluations` ADD `deliveryMode` enum('online','paper','both') DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE `evaluations` ADD `subject` varchar(80);--> statement-breakpoint
ALTER TABLE `evaluations` ADD `level` varchar(80);--> statement-breakpoint
ALTER TABLE `evaluations` ADD `ownerId` bigint unsigned;--> statement-breakpoint
ALTER TABLE `sessions` ADD `mode` enum('online','paper') DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE `classes` ADD CONSTRAINT `fk_classes_owner` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `paper_copies` ADD CONSTRAINT `fk_paper_copies_exam` FOREIGN KEY (`paperExamId`) REFERENCES `paper_exams`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `paper_copies` ADD CONSTRAINT `fk_paper_copies_student` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `paper_copies` ADD CONSTRAINT `fk_paper_copies_session` FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `paper_exams` ADD CONSTRAINT `fk_paper_exams_evaluation` FOREIGN KEY (`evaluationId`) REFERENCES `evaluations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `paper_exams` ADD CONSTRAINT `fk_paper_exams_class` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `paper_exams` ADD CONSTRAINT `fk_paper_exams_creator` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `students` ADD CONSTRAINT `fk_students_class` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_classes_owner` ON `classes` (`ownerId`);--> statement-breakpoint
CREATE INDEX `idx_paper_copies_exam` ON `paper_copies` (`paperExamId`);--> statement-breakpoint
CREATE INDEX `idx_paper_exams_eval` ON `paper_exams` (`evaluationId`);--> statement-breakpoint
CREATE INDEX `idx_paper_exams_class` ON `paper_exams` (`classId`);--> statement-breakpoint
CREATE INDEX `idx_students_class` ON `students` (`classId`);--> statement-breakpoint
ALTER TABLE `evaluations` ADD CONSTRAINT `fk_evaluations_owner` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;