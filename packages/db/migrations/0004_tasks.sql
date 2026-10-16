CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`user_id` text,
	`workspace_id` text,
	`action` text NOT NULL,
	`via` text NOT NULL,
	`repo_node_id` text,
	`target` text,
	`commit_sha` text,
	`detail` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "audit_log_via_ck" CHECK("audit_log"."via" IN ('user', 'app', 'local'))
);
--> statement-breakpoint
CREATE INDEX `audit_log_workspace_at_idx` ON `audit_log` (`workspace_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_log_user_at_idx` ON `audit_log` (`user_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_log_target_idx` ON `audit_log` (`target`);--> statement-breakpoint
CREATE TABLE `gh_issue_links` (
	`issue_node_id` text PRIMARY KEY NOT NULL,
	`parent_node_id` text,
	`blocked_by` text NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gh_issue_links_parent_idx` ON `gh_issue_links` (`parent_node_id`);--> statement-breakpoint
CREATE TABLE `workspace_github` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`installation_id` integer NOT NULL,
	`project_node_id` text NOT NULL,
	`kanban_field_id` text,
	`start_field_id` text,
	`target_field_id` text,
	`iteration_field_id` text,
	`linked_by` text,
	`linked_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `workspace_repos` (
	`workspace_id` text NOT NULL,
	`repo_node_id` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `repo_node_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_repos_repo_idx` ON `workspace_repos` (`repo_node_id`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `hide_label` text;