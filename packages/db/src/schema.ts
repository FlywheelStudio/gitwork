import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

/** Instance-wide key/value settings. The setup wizard writes these (decision 001). */
export const instanceSettings = sqliteTable("instance_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------------------------
// Identity — owned by Better Auth (decision 017). JS keys must match Better Auth's field names.
// ---------------------------------------------------------------------------------------------

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/** Better Auth's "account" model: a linked sign-in identity such as GitHub. Not a Gitwork Account. */
export const authIdentities = sqliteTable(
  "auth_identities",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("auth_identities_user_id_idx").on(t.userId),
    // One GitHub identity can back only one user.
    uniqueIndex("auth_identities_provider_account_uq").on(t.providerId, t.accountId),
  ],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/** Rate-limit counters. In the database because Worker isolates do not share memory. */
export const rateLimits = sqliteTable("rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

// ---------------------------------------------------------------------------------------------
// Domain — owned by Gitwork (decisions 006, 007, 017).
// ---------------------------------------------------------------------------------------------

export const ROLE_VALUES = ["owner", "admin", "member", "read_only"] as const;
const ROLE_CHECK = sql.raw(ROLE_VALUES.map((r) => `'${r}'`).join(", "));

/** A person or an agency. Owns workspaces. */
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

/** Account Owners are Owner in every workspace of the account. */
export const accountOwners = sqliteTable(
  "account_owners",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.userId] }), index("account_owners_user_id_idx").on(t.userId)],
);

/** One project: one Projects v2 board and a list of repos (linked in Phase 3). */
export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    readOnlyCanComment: integer("read_only_can_comment", { mode: "boolean" }).notNull().default(false),
    showDraftsToReadOnly: integer("show_drafts_to_read_only", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("workspaces_account_id_idx").on(t.accountId)],
);

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLE_VALUES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("workspace_members_user_id_idx").on(t.userId),
    check("workspace_members_role_ck", sql`${t.role} IN (${ROLE_CHECK})`),
  ],
);

/** Pending invites. Only the SHA-256 of the token is stored. Emails are lowercase. */
export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ROLE_VALUES }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    acceptedBy: text("accepted_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("invites_workspace_id_idx").on(t.workspaceId),
    index("invites_email_idx").on(t.email),
    check("invites_role_ck", sql`${t.role} IN (${ROLE_CHECK})`),
    check("invites_email_lower_ck", sql`${t.email} = lower(${t.email})`),
  ],
);

// ---------------------------------------------------------------------------------------------
// GitHub App and installations (Phase 2). Secrets are sealed with the secret box (AES-GCM).
// ---------------------------------------------------------------------------------------------

/** The instance's GitHub App, created by the manifest flow. At most one row (id = 1). */
export const githubApp = sqliteTable(
  "github_app",
  {
    id: integer("id").primaryKey(),
    appId: text("app_id").notNull(),
    slug: text("slug").notNull(),
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret").notNull(),
    webhookSecret: text("webhook_secret").notNull(),
    privateKey: text("private_key").notNull(),
    htmlUrl: text("html_url").notNull(),
    ownerLogin: text("owner_login").notNull(),
    createdAt: createdAt(),
  },
  (t) => [check("github_app_singleton_ck", sql`${t.id} = 1`)],
);

/** One-time `state` values for the manifest flow, bound to the admin who started it. */
export const githubManifestStates = sqliteTable("github_manifest_states", {
  stateHash: text("state_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
});

export const githubInstallations = sqliteTable("github_installations", {
  id: integer("id").primaryKey(),
  accountLogin: text("account_login").notNull(),
  accountId: integer("account_id").notNull(),
  accountType: text("account_type").notNull(),
  repositorySelection: text("repository_selection"),
  suspendedAt: integer("suspended_at", { mode: "timestamp_ms" }),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Installation access tokens, shared by all isolates until shortly before they expire. */
export const githubInstallationTokens = sqliteTable("github_installation_tokens", {
  installationId: integer("installation_id").primaryKey(),
  token: text("token").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

/** Processed webhook deliveries. Written in the same batch as the cache changes. */
export const githubWebhookDeliveries = sqliteTable("github_webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  event: text("event").notNull(),
  action: text("action"),
  installationId: integer("installation_id"),
  receivedAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
// Cache of GitHub data (decision 010). Writes are guarded by GitHub's updated_at; deletes are
// permanent tombstones. `available = false` hides rows the App can no longer reach.
// ---------------------------------------------------------------------------------------------

export const ghRepos = sqliteTable(
  "gh_repos",
  {
    nodeId: text("node_id").primaryKey(),
    githubId: integer("github_id").notNull().unique(),
    installationId: integer("installation_id").notNull(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    private: integer("private", { mode: "boolean" }).notNull(),
    defaultBranch: text("default_branch"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    htmlUrl: text("html_url").notNull(),
    available: integer("available", { mode: "boolean" }).notNull().default(true),
    syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("gh_repos_installation_idx").on(t.installationId)],
);

export const ghIssues = sqliteTable(
  "gh_issues",
  {
    nodeId: text("node_id").primaryKey(),
    repoNodeId: text("repo_node_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    state: text("state").notNull(),
    stateReason: text("state_reason"),
    labels: text("labels", { mode: "json" }).$type<{ name: string; color: string }[]>().notNull(),
    assignees: text("assignees", { mode: "json" }).$type<{ login: string; avatarUrl: string }[]>().notNull(),
    authorLogin: text("author_login"),
    issueType: text("issue_type"),
    htmlUrl: text("html_url").notNull(),
    createdAtGh: integer("created_at_gh", { mode: "timestamp_ms" }).notNull(),
    closedAtGh: integer("closed_at_gh", { mode: "timestamp_ms" }),
    githubUpdatedAt: integer("github_updated_at", { mode: "timestamp_ms" }).notNull(),
    deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
    syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("gh_issues_repo_number_uq").on(t.repoNodeId, t.number)],
);

export const ghProjects = sqliteTable("gh_projects", {
  nodeId: text("node_id").primaryKey(),
  installationId: integer("installation_id").notNull(),
  ownerLogin: text("owner_login").notNull(),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  closed: integer("closed", { mode: "boolean" }).notNull().default(false),
  url: text("url").notNull(),
  available: integer("available", { mode: "boolean" }).notNull().default(true),
  syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
});

export const ghProjectFields = sqliteTable(
  "gh_project_fields",
  {
    nodeId: text("node_id").primaryKey(),
    projectNodeId: text("project_node_id").notNull(),
    name: text("name").notNull(),
    dataType: text("data_type").notNull(),
    /** Single-select options or iteration configuration, as GitHub returns them. */
    config: text("config", { mode: "json" }).$type<unknown>(),
    syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("gh_project_fields_project_idx").on(t.projectNodeId)],
);

export type ProjectFieldValue =
  | { type: "text"; text: string }
  | { type: "number"; number: number }
  | { type: "date"; date: string }
  | { type: "single_select"; optionId: string; name: string }
  | { type: "iteration"; iterationId: string; title: string; startDate: string; duration: number };

export const ghProjectItems = sqliteTable(
  "gh_project_items",
  {
    nodeId: text("node_id").primaryKey(),
    projectNodeId: text("project_node_id").notNull(),
    contentType: text("content_type").notNull(),
    contentNodeId: text("content_node_id"),
    draftTitle: text("draft_title"),
    draftBody: text("draft_body"),
    /** Keyed by field node id. */
    fieldValues: text("field_values", { mode: "json" }).$type<Record<string, ProjectFieldValue>>().notNull(),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    githubUpdatedAt: integer("github_updated_at", { mode: "timestamp_ms" }).notNull(),
    deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
    syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("gh_project_items_project_idx").on(t.projectNodeId), index("gh_project_items_content_idx").on(t.contentNodeId)],
);

/** What reconcile keeps current. Phase 3 adds targets when a workspace links a board and repos. */
export const ghSyncTargets = sqliteTable(
  "gh_sync_targets",
  {
    kind: text("kind", { enum: ["repo", "project"] }).notNull(),
    nodeId: text("node_id").notNull(),
    installationId: integer("installation_id").notNull(),
    /** Repo: "owner/name". Project: "owner#number". */
    locator: text("locator").notNull(),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
    lastFullSyncAt: integer("last_full_sync_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.nodeId] }),
    check("gh_sync_targets_kind_ck", sql`${t.kind} IN ('repo', 'project')`),
  ],
);

/** A lease so overlapping cron runs or several Node instances never reconcile at once. */
export const syncLeases = sqliteTable("sync_leases", {
  name: text("name").primaryKey(),
  holder: text("holder").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});
