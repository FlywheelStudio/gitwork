CREATE TABLE `doc_pending_prs` (
	`repo_node_id` text NOT NULL,
	`base_branch` text NOT NULL,
	`path` text NOT NULL,
	`head_branch` text NOT NULL,
	`pr_number` integer NOT NULL,
	`pr_url` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`repo_node_id`, `base_branch`, `path`),
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `doc_pending_prs_pr_idx` ON `doc_pending_prs` (`repo_node_id`,`pr_number`);--> statement-breakpoint
CREATE TABLE `doc_presence` (
	`workspace_id` text NOT NULL,
	`repo_node_id` text NOT NULL,
	`path` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `repo_node_id`, `path`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gh_doc_blobs` (
	`sha` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`size` integer NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gh_doc_files` (
	`root_id` text NOT NULL,
	`path` text NOT NULL,
	`blob_sha` text NOT NULL,
	`size` integer NOT NULL,
	PRIMARY KEY(`root_id`, `path`)
);
--> statement-breakpoint
CREATE INDEX `gh_doc_files_blob_idx` ON `gh_doc_files` (`blob_sha`);--> statement-breakpoint
CREATE TABLE `gh_doc_roots` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_node_id` text NOT NULL,
	`branch` text NOT NULL,
	`path` text NOT NULL,
	`head_oid` text,
	`tree_oid` text,
	`truncated` integer DEFAULT false NOT NULL,
	`synced_at` integer
);
--> statement-breakpoint
CREATE INDEX `gh_doc_roots_repo_idx` ON `gh_doc_roots` (`repo_node_id`,`branch`);--> statement-breakpoint
ALTER TABLE `workspace_repos` ADD `docs_path` text DEFAULT 'docs' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_repos` ADD `docs_branch` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `hide_folder` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `review_bot_doc_edits` integer DEFAULT false NOT NULL;