/**
 * Cache writers (decision 010). Each returns one query, so callers can put it in a batch.
 * Guards live inside the statement (decision 016):
 *   - "newer": a webhook payload applies only if strictly newer than the row.
 *   - "fresh": data just fetched from GitHub also applies on an equal timestamp.
 *   - Tombstoned (deleted) rows never come back.
 */
import { type Db, type ProjectFieldValue, ghIssues, ghProjectFields, ghProjectItems, ghProjects, ghRepos } from "@gitwork/db";
import { type SQL, and, eq, getTableColumns, lt, not, sql } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

export type Freshness = "newer" | "fresh";

/** `SET col = excluded.col` for every column except the conflict key. */
function excludedSet(table: SQLiteTable, except: string[]): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const [key, column] of Object.entries(getTableColumns(table)) as [string, SQLiteColumn][]) {
    if (except.includes(key)) continue;
    set[key] = sql.raw(`excluded."${column.name}"`);
  }
  return set;
}

function guard(table: { githubUpdatedAt: SQLiteColumn; deleted: SQLiteColumn }, freshness: Freshness): SQL {
  const op = freshness === "newer" ? ">" : ">=";
  return sql`excluded."github_updated_at" ${sql.raw(op)} ${table.githubUpdatedAt} AND ${table.deleted} = 0`;
}

// ---- Issues -----------------------------------------------------------------------------------

export type IssueRow = typeof ghIssues.$inferInsert;

/** GitHub's REST/webhook issue JSON (pull requests excluded by the caller). */
export interface IssueJson {
  node_id: string;
  number: number;
  title: string;
  body?: string | null;
  state: string;
  state_reason?: string | null;
  labels?: ({ name?: string; color?: string } | string)[];
  assignees?: { login: string; avatar_url: string }[] | null;
  user?: { login: string } | null;
  type?: { name: string } | null;
  html_url: string;
  created_at: string;
  closed_at?: string | null;
  updated_at: string;
  pull_request?: unknown;
}

export function issueRow(repoNodeId: string, json: IssueJson, now: Date): IssueRow {
  return {
    nodeId: json.node_id,
    repoNodeId,
    number: json.number,
    title: json.title,
    body: json.body ?? null,
    state: json.state,
    stateReason: json.state_reason ?? null,
    labels: (json.labels ?? []).map((l) => (typeof l === "string" ? { name: l, color: "" } : { name: l.name ?? "", color: l.color ?? "" })),
    assignees: (json.assignees ?? []).map((a) => ({ login: a.login, avatarUrl: a.avatar_url })),
    authorLogin: json.user?.login ?? null,
    issueType: json.type?.name ?? null,
    htmlUrl: json.html_url,
    createdAtGh: new Date(json.created_at),
    closedAtGh: json.closed_at ? new Date(json.closed_at) : null,
    githubUpdatedAt: new Date(json.updated_at),
    deleted: false,
    syncedAt: now,
  };
}

export function upsertIssue(db: Db, row: IssueRow, freshness: Freshness) {
  return db
    .insert(ghIssues)
    .values(row)
    .onConflictDoUpdate({ target: ghIssues.nodeId, set: excludedSet(ghIssues, ["nodeId"]), setWhere: guard(ghIssues, freshness) });
}

/** Deletion or transfer out: permanent for this node id. */
export function tombstoneIssue(db: Db, nodeId: string, repoNodeId: string, number: number, at: Date) {
  return db
    .insert(ghIssues)
    .values({
      nodeId,
      repoNodeId,
      number,
      title: "",
      state: "deleted",
      labels: [],
      assignees: [],
      htmlUrl: "",
      createdAtGh: at,
      githubUpdatedAt: at,
      deleted: true,
      syncedAt: at,
    })
    .onConflictDoUpdate({ target: ghIssues.nodeId, set: { deleted: true, syncedAt: at } });
}

export async function storedIssueUpdatedAt(db: Db, nodeId: string): Promise<{ updatedAt: Date; deleted: boolean } | null> {
  const [row] = await db
    .select({ updatedAt: ghIssues.githubUpdatedAt, deleted: ghIssues.deleted })
    .from(ghIssues)
    .where(eq(ghIssues.nodeId, nodeId));
  return row ?? null;
}

// ---- Repos ------------------------------------------------------------------------------------

export interface RepoJson {
  node_id: string;
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch?: string;
  archived?: boolean;
  html_url?: string;
  owner?: { login: string };
}

export function upsertRepo(db: Db, installationId: number, json: RepoJson, now: Date) {
  const owner = json.owner?.login ?? json.full_name.split("/")[0]!;
  const row = {
    nodeId: json.node_id,
    githubId: json.id,
    installationId,
    owner,
    name: json.name,
    fullName: json.full_name,
    private: json.private,
    defaultBranch: json.default_branch ?? null,
    archived: json.archived ?? false,
    htmlUrl: json.html_url ?? `https://github.com/${json.full_name}`,
    available: true,
    syncedAt: now,
  };
  return db.insert(ghRepos).values(row).onConflictDoUpdate({ target: ghRepos.nodeId, set: excludedSet(ghRepos, ["nodeId"]) });
}

/**
 * A list as ONE bound parameter: `col IN (SELECT value FROM json_each(?))`. D1 allows only 100
 * bound parameters per query, and these lists come from GitHub (any length).
 */
export function inJsonList(column: SQLiteColumn, values: string[]): SQL {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;
}

/** Access removed (repo removed from the installation): stop serving its data. */
export function setReposAvailable(db: Db, repoNodeIds: string[], available: boolean) {
  return db.update(ghRepos).set({ available }).where(inJsonList(ghRepos.nodeId, repoNodeIds));
}

/** Installation deleted or suspended: hide everything it gave us; unsuspended: show it again. */
export function setInstallationAvailable(db: Db, installationId: number, available: boolean) {
  return [
    db.update(ghRepos).set({ available }).where(eq(ghRepos.installationId, installationId)),
    db.update(ghProjects).set({ available }).where(eq(ghProjects.installationId, installationId)),
  ] as const;
}

// ---- Projects v2 ------------------------------------------------------------------------------

export function upsertProject(db: Db, row: typeof ghProjects.$inferInsert) {
  return db.insert(ghProjects).values(row).onConflictDoUpdate({ target: ghProjects.nodeId, set: excludedSet(ghProjects, ["nodeId", "available"]) });
}

export function upsertProjectField(db: Db, row: typeof ghProjectFields.$inferInsert) {
  return db.insert(ghProjectFields).values(row).onConflictDoUpdate({ target: ghProjectFields.nodeId, set: excludedSet(ghProjectFields, ["nodeId"]) });
}

export type ProjectItemRow = typeof ghProjectItems.$inferInsert;

/** A ProjectV2Item node from GraphQL (see queries.ts ITEM_FIELDS). */
export interface ProjectItemNode {
  id: string;
  type: string;
  isArchived: boolean;
  updatedAt: string;
  project?: { id: string };
  content: { id?: string; title?: string; body?: string } | null;
  fieldValues: { nodes: FieldValueNode[] };
}

type FieldValueNode = { __typename: string; field?: { id?: string } } & Record<string, unknown>;

function fieldValue(node: FieldValueNode): ProjectFieldValue | null {
  switch (node.__typename) {
    case "ProjectV2ItemFieldTextValue":
      return { type: "text", text: String(node.text ?? "") };
    case "ProjectV2ItemFieldNumberValue":
      return { type: "number", number: Number(node.number) };
    case "ProjectV2ItemFieldDateValue":
      return { type: "date", date: String(node.date) };
    case "ProjectV2ItemFieldSingleSelectValue":
      return { type: "single_select", optionId: String(node.optionId), name: String(node.name) };
    case "ProjectV2ItemFieldIterationValue":
      return {
        type: "iteration",
        iterationId: String(node.iterationId),
        title: String(node.title),
        startDate: String(node.startDate),
        duration: Number(node.duration),
      };
    default:
      return null; // Labels, assignees, repository etc. come from the issue itself.
  }
}

export function projectItemRow(projectNodeId: string, node: ProjectItemNode, now: Date): ProjectItemRow {
  const values: Record<string, ProjectFieldValue> = {};
  for (const v of node.fieldValues.nodes) {
    const parsed = fieldValue(v);
    if (parsed && v.field?.id) values[v.field.id] = parsed;
  }
  const isDraft = node.type === "DRAFT_ISSUE";
  return {
    nodeId: node.id,
    projectNodeId,
    contentType: node.type,
    contentNodeId: isDraft ? null : (node.content?.id ?? null),
    draftTitle: isDraft ? (node.content?.title ?? "") : null,
    draftBody: isDraft ? (node.content?.body ?? null) : null,
    fieldValues: values,
    archived: node.isArchived,
    githubUpdatedAt: new Date(node.updatedAt),
    deleted: false,
    syncedAt: now,
  };
}

export function upsertProjectItem(db: Db, row: ProjectItemRow, freshness: Freshness) {
  return db
    .insert(ghProjectItems)
    .values(row)
    .onConflictDoUpdate({ target: ghProjectItems.nodeId, set: excludedSet(ghProjectItems, ["nodeId"]), setWhere: guard(ghProjectItems, freshness) });
}

export function tombstoneProjectItem(db: Db, nodeId: string, projectNodeId: string, at: Date) {
  return db
    .insert(ghProjectItems)
    .values({ nodeId, projectNodeId, contentType: "DELETED", fieldValues: {}, githubUpdatedAt: at, deleted: true, syncedAt: at })
    .onConflictDoUpdate({ target: ghProjectItems.nodeId, set: { deleted: true, syncedAt: at } });
}


/** After a complete sweep: rows GitHub no longer lists were deleted or moved. Tombstone them. */
export function tombstoneUnseenIssues(db: Db, repoNodeId: string, seen: string[], sweepStartedAt: Date) {
  return db
    .update(ghIssues)
    .set({ deleted: true })
    .where(
      and(
        eq(ghIssues.repoNodeId, repoNodeId),
        eq(ghIssues.deleted, false),
        lt(ghIssues.githubUpdatedAt, sweepStartedAt),
        not(inJsonList(ghIssues.nodeId, seen)),
      ),
    );
}

export function tombstoneUnseenProjectItems(db: Db, projectNodeId: string, seen: string[], sweepStartedAt: Date) {
  return db
    .update(ghProjectItems)
    .set({ deleted: true })
    .where(
      and(
        eq(ghProjectItems.projectNodeId, projectNodeId),
        eq(ghProjectItems.deleted, false),
        lt(ghProjectItems.githubUpdatedAt, sweepStartedAt),
        not(inJsonList(ghProjectItems.nodeId, seen)),
      ),
    );
}
