CREATE TABLE `gh_issues` (
	`node_id` text PRIMARY KEY NOT NULL,
	`repo_node_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`state` text NOT NULL,
	`state_reason` text,
	`labels` text NOT NULL,
	`assignees` text NOT NULL,
	`author_login` text,
	`issue_type` text,
	`html_url` text NOT NULL,
	`created_at_gh` integer NOT NULL,
	`closed_at_gh` integer,
	`github_updated_at` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gh_issues_repo_number_uq` ON `gh_issues` (`repo_node_id`,`number`);--> statement-breakpoint
CREATE TABLE `gh_project_fields` (
	`node_id` text PRIMARY KEY NOT NULL,
	`project_node_id` text NOT NULL,
	`name` text NOT NULL,
	`data_type` text NOT NULL,
	`config` text,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gh_project_fields_project_idx` ON `gh_project_fields` (`project_node_id`);--> statement-breakpoint
CREATE TABLE `gh_project_items` (
	`node_id` text PRIMARY KEY NOT NULL,
	`project_node_id` text NOT NULL,
	`content_type` text NOT NULL,
	`content_node_id` text,
	`draft_title` text,
	`draft_body` text,
	`field_values` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`github_updated_at` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gh_project_items_project_idx` ON `gh_project_items` (`project_node_id`);--> statement-breakpoint
CREATE INDEX `gh_project_items_content_idx` ON `gh_project_items` (`content_node_id`);--> statement-breakpoint
CREATE TABLE `gh_projects` (
	`node_id` text PRIMARY KEY NOT NULL,
	`installation_id` integer NOT NULL,
	`owner_login` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`closed` integer DEFAULT false NOT NULL,
	`url` text NOT NULL,
	`available` integer DEFAULT true NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gh_repos` (
	`node_id` text PRIMARY KEY NOT NULL,
	`github_id` integer NOT NULL,
	`installation_id` integer NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`full_name` text NOT NULL,
	`private` integer NOT NULL,
	`default_branch` text,
	`archived` integer DEFAULT false NOT NULL,
	`html_url` text NOT NULL,
	`available` integer DEFAULT true NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gh_repos_github_id_unique` ON `gh_repos` (`github_id`);--> statement-breakpoint
CREATE INDEX `gh_repos_installation_idx` ON `gh_repos` (`installation_id`);--> statement-breakpoint
CREATE TABLE `gh_sync_targets` (
	`kind` text NOT NULL,
	`node_id` text NOT NULL,
	`installation_id` integer NOT NULL,
	`locator` text NOT NULL,
	`last_synced_at` integer,
	`last_full_sync_at` integer,
	PRIMARY KEY(`kind`, `node_id`),
	CONSTRAINT "gh_sync_targets_kind_ck" CHECK("gh_sync_targets"."kind" IN ('repo', 'project'))
);
--> statement-breakpoint
CREATE TABLE `github_app` (
	`id` integer PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`slug` text NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text NOT NULL,
	`webhook_secret` text NOT NULL,
	`private_key` text NOT NULL,
	`html_url` text NOT NULL,
	`owner_login` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "github_app_singleton_ck" CHECK("github_app"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `github_installation_tokens` (
	`installation_id` integer PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `github_installations` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_login` text NOT NULL,
	`account_id` integer NOT NULL,
	`account_type` text NOT NULL,
	`repository_selection` text,
	`suspended_at` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `github_manifest_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `github_webhook_deliveries` (
	`delivery_id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`action` text,
	`installation_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_leases` (
	`name` text PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`expires_at` integer NOT NULL
);
