/**
 * Reconcile (decision 010): repair what webhooks missed. Bounded per run (Workers cap queries and
 * CPU per invocation), and every page saves its progress, so a run that is cut short still moves
 * forward and the next run continues.
 *
 * Repos:  1. Incremental: issues by `updated_at` since the cursor (2-minute overlap).
 *         2. Daily deletion sweep: list by creation order with a saved page cursor, mark each
 *            issue seen; at the end, verify the unseen ones with GitHub (nodes(ids:)) before
 *            tombstoning — a page shift during the sweep must never delete a live issue.
 * Boards: Projects v2 has no "since": list every item (cursor saved per page, archived included),
 *         then verify unseen items the same way.
 */
import { type Db, ghRepos, ghSyncTargets } from "@gitwork/db";
import { acquireLease, releaseLease } from "../leases";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  type IssueJson,
  type RepoJson,
  inJsonList,
  issueRow,
  itemIssueLinks,
  markIssuesDeleted,
  markProjectItemsDeleted,
  projectItemRow,
  setReposAvailable,
  touchIssues,
  touchProjectItems,
  unseenIssues,
  unseenProjectItems,
  upsertIssue,
  upsertProject,
  upsertProjectField,
  upsertProjectItem,
  upsertRepo,
} from "./cache";
import { type GitHubClient, GitHubError, GitHubRateLimitError } from "./client";
import { PROJECT_PAGE, type ProjectPageResult, VERIFY_NODES, type VerifyNodesResult } from "./queries";

export interface ReconcileOptions {
  db: Db;
  client: GitHubClient;
  holder: string;
  now?: () => Date;
  /** Targets per run. Default 3. */
  maxTargets?: number;
  /** GitHub pages per target per run. Default 10. */
  maxPages?: number;
  /** Only these targets (e.g. right after a workspace links them). */
  onlyNodeIds?: string[];
}

export interface ReconcileResult {
  skipped?: "lease_held";
  synced: string[];
  failed: { target: string; error: string }[];
  rateLimited: boolean;
}

const LEASE_MS = 10 * 60_000;
const SINCE_OVERLAP_MS = 2 * 60_000;
const SWEEP_EVERY_MS = 24 * 60 * 60_000;
const VERIFY_BATCH = 100;
const WRITE_BATCH = 100;

type Target = typeof ghSyncTargets.$inferSelect;
type Write = Parameters<Db["batch"]>[0][number];

async function write(db: Db, writes: Write[]) {
  for (let i = 0; i < writes.length; i += WRITE_BATCH) {
    const chunk = writes.slice(i, i + WRITE_BATCH);
    if (chunk.length > 0) await db.batch(chunk as unknown as Parameters<Db["batch"]>[0]);
  }
}

function targetWhere(target: Target) {
  return and(eq(ghSyncTargets.kind, target.kind), eq(ghSyncTargets.nodeId, target.nodeId));
}

async function saveTarget(db: Db, target: Target, set: Partial<Omit<Target, "kind" | "nodeId">>) {
  await db.update(ghSyncTargets).set(set).where(targetWhere(target));
  Object.assign(target, set);
}

export async function reconcile(options: ReconcileOptions): Promise<ReconcileResult> {
  const { db, holder } = options;
  const now = options.now ?? (() => new Date());
  const result: ReconcileResult = { synced: [], failed: [], rateLimited: false };
  if (!(await acquireLease(db, "reconcile", holder, LEASE_MS, now()))) return { ...result, skipped: "lease_held" };
  try {
    const targets = await db
      .select()
      .from(ghSyncTargets)
      .where(options.onlyNodeIds ? inJsonList(ghSyncTargets.nodeId, options.onlyNodeIds) : undefined)
      .orderBy(sql`${ghSyncTargets.lastSyncedAt} IS NOT NULL`, asc(ghSyncTargets.lastSyncedAt))
      .limit(options.maxTargets ?? 3);
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
    await releaseLease(db, "reconcile", holder);
  }
  return result;
}

// ---- Repos ------------------------------------------------------------------------------------

async function syncRepo(options: ReconcileOptions, target: Target, now: () => Date) {
  const { db, client } = options;
  const auth = { installationId: target.installationId };
  const started = now();
  let pages = options.maxPages ?? 10;

  // A repo hidden earlier (access removed, installation suspended) is re-checked every run, so
  // regained access shows up within one reconcile instead of after the daily sweep.
  const [known] = await db.select({ available: ghRepos.available }).from(ghRepos).where(eq(ghRepos.nodeId, target.nodeId));
  if (known && !known.available) {
    try {
      await upsertRepo(db, target.installationId, await client.rest<RepoJson>("GET", `/repos/${target.locator}`, auth), started);
    } catch (error) {
      if (error instanceof GitHubError && (error.status === 404 || error.status === 403)) return;
      throw error;
    }
  }

  // 1. Incremental, saving the cursor after every page. The cursor is a lower bound in GitHub's
  //    time: mid-pass it is the last issue's updated_at; after a pass, our start time minus the
  //    overlap (clock skew). `since` steps back one second so equal timestamps are not lost.
  const cursor = target.lastSyncedAt;
  const since = cursor ? `&since=${new Date(cursor.getTime() - 1000).toISOString()}` : "";
  let used = 0;
  const { done } = await client.paginate<IssueJson>(
    `/repos/${target.locator}/issues?state=all&sort=updated&direction=asc&per_page=100${since}`,
    auth,
    pages,
    async (page) => {
      used++;
      const issues = page.filter((i) => !i.pull_request);
      await write(db, issues.map((i) => upsertIssue(db, issueRow(target.nodeId, i, now()), "fresh")));
      const last = page.at(-1);
      if (last) {
        let next = new Date(last.updated_at);
        // A full page sharing one second makes no progress: step past it. The daily sweep
        // upserts every issue, so anything skipped here is caught within a day.
        if (target.lastSyncedAt && next.getTime() <= target.lastSyncedAt.getTime()) next = new Date(target.lastSyncedAt.getTime() + 1000);
        await saveTarget(db, target, { lastSyncedAt: next });
      }
    },
  );
  if (!done) return;
  // The sweep always gets at least one page, or a tight budget would starve it forever.
  pages = Math.max(pages - used, 1);
  await saveTarget(db, target, { lastSyncedAt: new Date(started.getTime() - SINCE_OVERLAP_MS) });

  // 2. Deletion sweep: due daily, or resuming one in progress.
  const due = !target.lastFullSyncAt || started.getTime() - target.lastFullSyncAt.getTime() > SWEEP_EVERY_MS;
  if (!target.sweepStartedAt && !due) return;
  if (!target.sweepStartedAt) {
    try {
      const repo = await client.rest<RepoJson>("GET", `/repos/${target.locator}`, auth);
      await upsertRepo(db, target.installationId, repo, started);
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) {
        await setReposAvailable(db, [target.nodeId], false);
        await saveTarget(db, target, { lastFullSyncAt: started });
        return;
      }
      throw error;
    }
    await saveTarget(db, target, {
      sweepStartedAt: started,
      sweepCursor: `/repos/${target.locator}/issues?state=all&sort=created&direction=asc&per_page=100`,
    });
  }
  const sweepStartedAt = target.sweepStartedAt!;
  if (target.sweepCursor && pages > 0) {
    let next: string | null = target.sweepCursor;
    for (; next && pages > 0; pages--) {
      const res: { items: IssueJson[]; next: string | null } = await client.page<IssueJson>(next, auth);
      const issues = res.items.filter((i) => !i.pull_request);
      const at = now();
      await write(db, [
        ...issues.map((i) => upsertIssue(db, issueRow(target.nodeId, i, at), "fresh")),
        ...(issues.length > 0 ? [touchIssues(db, issues.map((i) => i.node_id), at)] : []),
      ]);
      next = res.next;
      await saveTarget(db, target, { sweepCursor: next });
    }
    if (next) return; // out of budget; continue next run
  }
  if (target.sweepCursor) return;

  // Listing finished: verify what the sweep did not see, then finish.
  const finished = await verifyUnseen(options, target, sweepStartedAt, "issue");
  if (finished) await saveTarget(db, target, { lastFullSyncAt: sweepStartedAt, sweepStartedAt: null, sweepCursor: null });
}

// ---- Boards -----------------------------------------------------------------------------------

async function syncProject(options: ReconcileOptions, target: Target, now: () => Date) {
  const { db, client } = options;
  if (!target.sweepStartedAt) await saveTarget(db, target, { sweepStartedAt: now(), sweepCursor: "" });
  const sweepStartedAt = target.sweepStartedAt!;
  let after: string | null = target.sweepCursor || null;
  let complete = target.sweepCursor === null;

  for (let page = 0; !complete && page < (options.maxPages ?? 10); page++) {
    const data: ProjectPageResult = await client.graphql<ProjectPageResult>(target.installationId, PROJECT_PAGE, { id: target.nodeId, after });
    const project = data.node;
    if (!project) {
      await saveTarget(db, target, { lastSyncedAt: now(), sweepStartedAt: null, sweepCursor: null });
      return;
    }
    const at = now();
    const writes: Write[] = [];
    if (!after) {
      writes.push(
        upsertProject(db, {
          nodeId: project.id,
          installationId: target.installationId,
          ownerLogin: project.owner.login,
          number: project.number,
          title: project.title,
          closed: project.closed,
          url: project.url,
          syncedAt: at,
        }),
        ...project.fields.nodes
          .filter((f) => f.id && f.name && f.dataType)
          .map((f) =>
            upsertProjectField(db, {
              nodeId: f.id!,
              projectNodeId: project.id,
              name: f.name!,
              dataType: f.dataType!,
              config: f.options ?? f.configuration ?? null,
              syncedAt: at,
            }),
          ),
      );
    }
    const items = project.items.nodes;
    writes.push(...items.map((n) => upsertProjectItem(db, projectItemRow(project.id, n, at), "fresh")));
    writes.push(...items.flatMap((n) => itemIssueLinks(db, n, at)));
    if (items.length > 0) writes.push(touchProjectItems(db, items.map((i) => i.id), at));
    await write(db, writes);
    complete = !project.items.pageInfo.hasNextPage;
    after = project.items.pageInfo.endCursor;
    await saveTarget(db, target, { sweepCursor: complete ? null : after });
  }
  if (!complete) return;

  const finished = await verifyUnseen(options, target, sweepStartedAt, "item");
  if (finished) await saveTarget(db, target, { lastSyncedAt: sweepStartedAt, lastFullSyncAt: sweepStartedAt, sweepStartedAt: null, sweepCursor: null });
}

// ---- Verification -----------------------------------------------------------------------------

/** Tombstones unseen rows that GitHub confirms are gone or moved. True when none remain. */
async function verifyUnseen(options: ReconcileOptions, target: Target, sweepStartedAt: Date, kind: "issue" | "item"): Promise<boolean> {
  const { db, client } = options;
  for (let round = 0; round < 3; round++) {
    const ids =
      kind === "issue"
        ? await unseenIssues(db, target.nodeId, sweepStartedAt, VERIFY_BATCH)
        : await unseenProjectItems(db, target.nodeId, sweepStartedAt, VERIFY_BATCH);
    if (ids.length === 0) return true;
    const { nodes } = await client.graphql<VerifyNodesResult>(target.installationId, VERIFY_NODES, { ids }, { allowNotFound: true });
    const gone: string[] = [];
    const alive: string[] = [];
    ids.forEach((id, i) => {
      const node = nodes[i];
      const parent = kind === "issue" ? node?.repository?.id : node?.project?.id;
      (node && parent === target.nodeId ? alive : gone).push(id);
    });
    const at = new Date(Math.max(Date.now(), sweepStartedAt.getTime() + 1));
    await write(db, [
      ...(gone.length > 0 ? [kind === "issue" ? markIssuesDeleted(db, gone) : markProjectItemsDeleted(db, gone)] : []),
      ...(alive.length > 0 ? [kind === "issue" ? touchIssues(db, alive, at) : touchProjectItems(db, alive, at)] : []),
    ]);
  }
  return false;
}
