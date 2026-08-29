CREATE TABLE `answer_drafts` (
	`sessionId` bigint unsigned NOT NULL,
	`questionId` bigint unsigned NOT NULL,
	`answer` text,
	`justification` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`committedAt` timestamp,
	CONSTRAINT `pk_answer_drafts` PRIMARY KEY(`sessionId`,`questionId`)
);
--> statement-breakpoint
CREATE TABLE `cheat_events` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`sessionId` bigint unsigned NOT NULL,
	`type` enum('tab_switch','blur','context_menu','copy','paste','fullscreen_exit','print','devtools_open','fingerprint_mismatch','multi_device','prolonged_blur','idle_disconnect','window_size_anomaly') NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`metadata` json,
	CONSTRAINT `cheat_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `evaluations` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`duration` int NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `evaluations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`evaluationId` bigint unsigned NOT NULL,
	`type` enum('qcm','short_answer','true_false') NOT NULL,
	`question` text NOT NULL,
	`options` json,
	`correctAnswer` text NOT NULL,
	`justificationRequired` boolean DEFAULT false,
	`points` int NOT NULL DEFAULT 1,
	`gradingRubric` json,
	`order` int NOT NULL DEFAULT 0,
	`imageUrl` text,
	`tags` json,
	`difficulty` tinyint unsigned,
	CONSTRAINT `questions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `responses` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`sessionId` bigint unsigned NOT NULL,
	`questionId` bigint unsigned NOT NULL,
	`answer` text NOT NULL,
	`justification` text,
	`isCorrect` boolean,
	`score` int,
	`maxScore` int,
	`llmFeedback` text,
	`gradingMode` varchar(20),
	`llmConfidence` decimal(3,2),
	`gradingReason` text,
	`partialCreditApplied` boolean NOT NULL DEFAULT false,
	`gradedAt` timestamp,
	CONSTRAINT `responses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`evaluationId` bigint unsigned NOT NULL,
	`studentName` varchar(255) NOT NULL,
	`studentEmail` varchar(320),
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`endedAt` timestamp,
	`expiresAt` timestamp,
	`ipAddress` varchar(45),
	`userAgent` text,
	`fingerprintHash` varchar(64),
	`status` enum('in_progress','completed','timed_out','cheating_detected','auto_submitted_idle') NOT NULL DEFAULT 'in_progress',
	`tabSwitchCount` int NOT NULL DEFAULT 0,
	`cheatEvents` json,
	`totalScore` int,
	`maxScore` int,
	`normalizedScore` decimal(5,2),
	`timeSpent` int,
	`shuffleSeed` varchar(64),
	`resultsToken` text,
	`lastHeartbeatAt` timestamp,
	`suspicionScore` tinyint unsigned DEFAULT 0,
	`suspicionVerdict` enum('clean','minor','moderate','severe') DEFAULT 'clean',
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`unionId` varchar(255) NOT NULL,
	`name` varchar(255),
	`email` varchar(320),
	`avatar` text,
	`role` enum('student','teacher','admin') NOT NULL DEFAULT 'teacher',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignInAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_unionId_unique` UNIQUE(`unionId`)
);
--> statement-breakpoint
ALTER TABLE `answer_drafts` ADD CONSTRAINT `fk_answer_drafts_session` FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `answer_drafts` ADD CONSTRAINT `fk_answer_drafts_question` FOREIGN KEY (`questionId`) REFERENCES `questions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cheat_events` ADD CONSTRAINT `fk_cheat_events_session` FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `questions` ADD CONSTRAINT `fk_questions_evaluation` FOREIGN KEY (`evaluationId`) REFERENCES `evaluations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `responses` ADD CONSTRAINT `fk_responses_session` FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `responses` ADD CONSTRAINT `fk_responses_question` FOREIGN KEY (`questionId`) REFERENCES `questions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `fk_sessions_evaluation` FOREIGN KEY (`evaluationId`) REFERENCES `evaluations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_cheat_session` ON `cheat_events` (`sessionId`);--> statement-breakpoint
CREATE INDEX `idx_responses_session` ON `responses` (`sessionId`);--> statement-breakpoint
CREATE INDEX `idx_sessions_started` ON `sessions` (`startedAt`);--> statement-breakpoint
CREATE INDEX `idx_sessions_status` ON `sessions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sessions_eval` ON `sessions` (`evaluationId`);