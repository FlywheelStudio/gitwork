/**
 * Reconcile (decision 010): repair what webhooks missed. Bounded per run (Workers limit queries
 * and CPU per invocation): the oldest-synced targets first; the next run continues.
 */
import { type Db, ghSyncTargets, syncLeases } from "@gitwork/db";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import {
  type IssueJson,
  type RepoJson,
  issueRow,
  projectItemRow,
  setReposAvailable,
  tombstoneUnseenIssues,
  tombstoneUnseenProjectItems,
  upsertIssue,
  upsertProject,
  upsertProjectField,
  upsertProjectItem,
  upsertRepo,
} from "./cache";
import { type GitHubClient, GitHubError, GitHubRateLimitError } from "./client";
import { PROJECT_PAGE, type ProjectPageResult } from "./queries";

export interface ReconcileOptions {
  db: Db;
  client: GitHubClient;
  holder: string;
  now?: () => Date;
  maxTargets?: number;
  maxPages?: number;
}

export interface ReconcileResult {
  skipped?: "lease_held";
  synced: string[];
  failed: { target: string; error: string }[];
  rateLimited: boolean;
}

const LEASE_MS = 10 * 60_000;
const SINCE_OVERLAP_MS = 2 * 60_000;
const FULL_SWEEP_EVERY_MS = 24 * 60 * 60_000;
const BATCH = 50;

type Target = typeof ghSyncTargets.$inferSelect;

/** Takes the lease if it is free or expired. One atomic statement on both drivers. */
async function acquireLease(db: Db, holder: string, now: Date): Promise<boolean> {
  const [row] = await db
    .insert(syncLeases)
    .values({ name: "reconcile", holder, expiresAt: new Date(now.getTime() + LEASE_MS) })
    .onConflictDoUpdate({
      target: syncLeases.name,
      set: { holder, expiresAt: new Date(now.getTime() + LEASE_MS) },
      setWhere: lt(syncLeases.expiresAt, now),
    })
    .returning({ holder: syncLeases.holder });
  return row?.holder === holder;
}

async function writeInBatches(db: Db, writes: Parameters<Db["batch"]>[0][number][]) {
  for (let i = 0; i < writes.length; i += BATCH) {
    await db.batch(writes.slice(i, i + BATCH) as unknown as Parameters<Db["batch"]>[0]);
  }
}

export async function reconcile(options: ReconcileOptions): Promise<ReconcileResult> {
  const { db, holder } = options;
  const now = options.now ?? (() => new Date());
  const result: ReconcileResult = { synced: [], failed: [], rateLimited: false };
  if (!(await acquireLease(db, holder, now()))) return { ...result, skipped: "lease_held" };
  try {
    const targets = await db
      .select()
      .from(ghSyncTargets)
      .orderBy(sql`${ghSyncTargets.lastSyncedAt} IS NOT NULL`, asc(ghSyncTargets.lastSyncedAt))
      .limit(options.maxTargets ?? 5);
    for (const target of targets) {
      try {
        if (target.kind === "repo") await syncRepo(options, target, now);
        else await syncProject(options, target, now);
        result.synced.push(`${target.kind}:${target.locator}`);
      } catch (error) {
        if (error instanceof GitHubRateLimitError) {
          result.rateLimited = true;
          break;
        }
        result.failed.push({ target: `${target.kind}:${target.locator}`, error: (error as Error).message });
      }
    }
  } finally {
    await db.delete(syncLeases).where(and(eq(syncLeases.name, "reconcile"), eq(syncLeases.holder, holder)));
  }
  return result;
}

async function markSynced(db: Db, target: Target, set: Partial<Pick<Target, "lastSyncedAt" | "lastFullSyncAt">>) {
  await db
    .update(ghSyncTargets)
    .set(set)
    .where(and(eq(ghSyncTargets.kind, target.kind), eq(ghSyncTargets.nodeId, target.nodeId)));
}

async function syncRepo(options: ReconcileOptions, target: Target, now: () => Date) {
  const { db, client } = options;
  const auth = { installationId: target.installationId };
  const started = now();
  const full = !target.lastFullSyncAt || started.getTime() - target.lastFullSyncAt.getTime() > FULL_SWEEP_EVERY_MS;

  if (full) {
    // Repo metadata and access. 404: the App lost access or the repo is gone.
    try {
      const repo = await client.rest<RepoJson>("GET", `/repos/${target.locator}`, auth);
      await upsertRepo(db, target.installationId, repo, started);
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) {
        await setReposAvailable(db, [target.nodeId], false);
        await markSynced(db, target, { lastSyncedAt: started, lastFullSyncAt: started });
        return;
      }
      throw error;
    }
  }

  const since =
    !full && target.lastSyncedAt ? `&since=${new Date(target.lastSyncedAt.getTime() - SINCE_OVERLAP_MS).toISOString()}` : "";
  const seen: string[] = [];
  let lastUpdated: Date | null = null;
  const { done } = await client.paginate<IssueJson>(
    `/repos/${target.locator}/issues?state=all&sort=updated&direction=asc&per_page=100${since}`,
    auth,
    options.maxPages ?? 20,
    async (page) => {
      const issues = page.filter((i) => !i.pull_request);
      for (const i of issues) seen.push(i.node_id);
      await writeInBatches(db, issues.map((i) => upsertIssue(db, issueRow(target.nodeId, i, started), "fresh")));
      const last = page.at(-1);
      if (last) lastUpdated = new Date(last.updated_at);
    },
  );

  if (done) {
    if (full) await tombstoneUnseenIssues(db, target.nodeId, seen, started);
    await markSynced(db, target, full ? { lastSyncedAt: started, lastFullSyncAt: started } : { lastSyncedAt: started });
  } else if (lastUpdated) {
    // Out of page budget: continue from the last issue processed (sorted by updated, ascending).
    await markSynced(db, target, { lastSyncedAt: lastUpdated });
  }
}

async function syncProject(options: ReconcileOptions, target: Target, now: () => Date) {
  const { db, client } = options;
  const started = now();
  const seen: string[] = [];
  let after: string | null = null;
  let complete = false;
  for (let page = 0; page < (options.maxPages ?? 20); page++) {
    const data: ProjectPageResult = await client.graphql<ProjectPageResult>(target.installationId, PROJECT_PAGE, { id: target.nodeId, after });
    const project = data.node;
    if (!project) {
      await db.update(ghSyncTargets).set({ lastSyncedAt: started }).where(eq(ghSyncTargets.nodeId, target.nodeId));
      return;
    }
    if (page === 0) {
      await upsertProject(db, {
        nodeId: project.id,
        installationId: target.installationId,
        ownerLogin: project.owner.login,
        number: project.number,
        title: project.title,
        closed: project.closed,
        url: project.url,
        syncedAt: started,
      });
      await writeInBatches(
        db,
        project.fields.nodes
          .filter((f) => f.id && f.name && f.dataType)
          .map((f) =>
            upsertProjectField(db, {
              nodeId: f.id!,
              projectNodeId: project.id,
              name: f.name!,
              dataType: f.dataType!,
              config: f.options ?? f.configuration ?? null,
              syncedAt: started,
            }),
          ),
      );
    }
    for (const item of project.items.nodes) seen.push(item.id);
    await writeInBatches(db, project.items.nodes.map((n) => upsertProjectItem(db, projectItemRow(project.id, n, started), "fresh")));
    if (!project.items.pageInfo.hasNextPage) {
      complete = true;
      break;
    }
    after = project.items.pageInfo.endCursor;
  }
  // Projects v2 has no "since": every run lists all items, so a complete run also finds deletions.
  if (complete) await tombstoneUnseenProjectItems(db, target.nodeId, seen, started);
  await markSynced(db, target, complete ? { lastSyncedAt: started, lastFullSyncAt: started } : {});
}
