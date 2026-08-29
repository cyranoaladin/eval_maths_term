CREATE TABLE `grade_audit` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`sessionId` bigint unsigned NOT NULL,
	`responseId` bigint unsigned,
	`questionId` bigint unsigned,
	`actorId` bigint unsigned,
	`actorEmail` varchar(320),
	`action` enum('manual_override','manual_paper','regrade') NOT NULL,
	`oldScore` decimal(6,2),
	`newScore` decimal(6,2),
	`oldMode` varchar(24),
	`newMode` varchar(24),
	`reason` varchar(500),
	`requestId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `grade_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `grade_audit` ADD CONSTRAINT `fk_grade_audit_session` FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `grade_audit` ADD CONSTRAINT `fk_grade_audit_response` FOREIGN KEY (`responseId`) REFERENCES `responses`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `grade_audit` ADD CONSTRAINT `fk_grade_audit_question` FOREIGN KEY (`questionId`) REFERENCES `questions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `grade_audit` ADD CONSTRAINT `fk_grade_audit_actor` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_grade_audit_session` ON `grade_audit` (`sessionId`);--> statement-breakpoint
CREATE INDEX `idx_grade_audit_created` ON `grade_audit` (`createdAt`);