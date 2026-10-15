/**
 * POST /api/github/webhook (decision 010).
 * 1. Verify X-Hub-Signature-256 on the raw body, before parsing.
 * 2. Skip deliveries already processed.
 * 3. Fetch anything needed from GitHub, then write ONE batch: the delivery row first, then the
 *    guarded cache writes. A duplicate fails on the delivery's primary key and rolls back the
 *    batch; a real failure leaves no trace, so a redelivery or reconcile can still apply it.
 */
import { type Db, githubInstallationTokens, githubInstallations, githubWebhookDeliveries, ghProjects, ghSyncTargets } from "@gitwork/db";
import { and, eq } from "drizzle-orm";
import {
  type IssueJson,
  type ProjectItemNode,
  type RepoJson,
  issueRow,
  projectItemRow,
  setInstallationAvailable,
  setReposAvailable,
  storedIssueUpdatedAt,
  tombstoneIssue,
  tombstoneProjectItem,
  upsertIssue,
  upsertProjectItem,
  upsertRepo,
} from "./cache";
import type { GitHubClient } from "./client";
import type { GitHubAppConfig } from "./config";
import { verifyWebhookSignature } from "./crypto";
import { PROJECT_ITEM } from "./queries";

export interface WebhookDeps {
  db: Db;
  app: GitHubAppConfig;
  client: GitHubClient;
  now?: () => Date;
}

type Write = Parameters<Db["batch"]>[0][number];
type Payload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const json = (status: number, data: unknown) => Response.json(data, { status });

export async function handleGitHubWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  const raw = await request.text();
  if (!(await verifyWebhookSignature(deps.app.webhookSecret, raw, request.headers.get("x-hub-signature-256")))) {
    return json(401, { error: "invalid signature" });
  }
  const deliveryId = request.headers.get("x-github-delivery");
  const event = request.headers.get("x-github-event");
  if (!deliveryId || !event) return json(400, { error: "missing delivery headers" });
  if (await seen(deps.db, deliveryId)) return json(200, { status: "duplicate" });

  const payload = JSON.parse(raw) as Payload;
  const installationId: number | null = payload.installation?.id ?? null;
  const writes = await planWrites(event, payload, deps);
  try {
    await deps.db.batch([
      deps.db.insert(githubWebhookDeliveries).values({ deliveryId, event, action: payload.action ?? null, installationId }),
      ...writes,
    ] as Parameters<Db["batch"]>[0]);
  } catch (error) {
    if (await seen(deps.db, deliveryId)) return json(200, { status: "duplicate" });
    throw error;
  }
  return json(200, { status: "processed", writes: writes.length });
}

async function seen(db: Db, deliveryId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: githubWebhookDeliveries.deliveryId })
    .from(githubWebhookDeliveries)
    .where(eq(githubWebhookDeliveries.deliveryId, deliveryId));
  return row !== undefined;
}

async function planWrites(event: string, p: Payload, deps: WebhookDeps): Promise<Write[]> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const installationId: number | undefined = p.installation?.id;

  switch (event) {
    case "installation": {
      const inst = p.installation;
      const row = {
        id: inst.id as number,
        accountLogin: inst.account.login as string,
        accountId: inst.account.id as number,
        accountType: inst.account.type as string,
        repositorySelection: (inst.repository_selection as string) ?? null,
        suspendedAt: inst.suspended_at ? new Date(inst.suspended_at) : null,
        deletedAt: p.action === "deleted" ? now : null,
        updatedAt: now,
      };
      const upsert = db
        .insert(githubInstallations)
        .values(row)
        .onConflictDoUpdate({ target: githubInstallations.id, set: { ...row, id: undefined } });
      if (p.action === "deleted") {
        return [
          upsert,
          ...setInstallationAvailable(db, inst.id, false),
          db.delete(githubInstallationTokens).where(eq(githubInstallationTokens.installationId, inst.id)),
        ];
      }
      if (p.action === "suspend") return [upsert, ...setInstallationAvailable(db, inst.id, false)];
      if (p.action === "unsuspend") return [upsert, ...setInstallationAvailable(db, inst.id, true)];
      return [upsert, ...((p.repositories ?? []) as RepoJson[]).map((r) => upsertRepo(db, inst.id, r, now))];
    }

    case "installation_repositories": {
      const added = ((p.repositories_added ?? []) as RepoJson[]).map((r) => upsertRepo(db, p.installation.id, r, now));
      const removed = ((p.repositories_removed ?? []) as RepoJson[]).map((r) => r.node_id);
      return removed.length > 0 ? [...added, setReposAvailable(db, removed, false)] : added;
    }

    case "repository": {
      if (!installationId) return [];
      if (p.action === "deleted") return [setReposAvailable(db, [p.repository.node_id], false)];
      return [upsertRepo(db, installationId, p.repository as RepoJson, now)];
    }

    case "issues": {
      const issue = p.issue as IssueJson;
      const repoNodeId: string = p.repository.node_id;
      if (issue.pull_request) return [];
      if (p.action === "deleted") return [tombstoneIssue(db, issue.node_id, repoNodeId, issue.number, now)];
      if (p.action === "transferred") {
        const writes: Write[] = [tombstoneIssue(db, issue.node_id, repoNodeId, issue.number, now)];
        const moved = p.changes?.new_issue as IssueJson | undefined;
        const newRepo = p.changes?.new_repository as RepoJson | undefined;
        if (moved && newRepo) writes.push(upsertIssue(db, issueRow(newRepo.node_id, moved, now), "newer"));
        return writes;
      }
      // Timestamps have one-second resolution. On a tie the payload might be the older of two
      // edits, so ask GitHub for the current issue instead of trusting it.
      const stored = await storedIssueUpdatedAt(db, issue.node_id);
      if (stored && !stored.deleted && stored.updatedAt.getTime() === new Date(issue.updated_at).getTime() && installationId) {
        const fresh = await deps.client.rest<IssueJson>("GET", `/repos/${p.repository.full_name}/issues/${issue.number}`, { installationId });
        return [upsertIssue(db, issueRow(repoNodeId, fresh, now), "fresh")];
      }
      return [upsertIssue(db, issueRow(repoNodeId, issue, now), "newer")];
    }

    case "projects_v2_item": {
      const item = p.projects_v2_item;
      const projectNodeId: string = item.project_node_id;
      if (!installationId || !(await isProjectTarget(db, projectNodeId))) return [];
      if (p.action === "deleted") return [tombstoneProjectItem(db, item.node_id, projectNodeId, now)];
      // The payload says *that* an item changed, not its new field values: fetch the item.
      const data = await deps.client.graphql<{ node: ProjectItemNode | null }>(installationId, PROJECT_ITEM, { id: item.node_id });
      if (!data.node) return [tombstoneProjectItem(db, item.node_id, projectNodeId, now)];
      return [upsertProjectItem(db, projectItemRow(projectNodeId, data.node, now), "fresh")];
    }

    case "projects_v2": {
      if (p.action === "deleted") {
        return [db.update(ghProjects).set({ available: false }).where(eq(ghProjects.nodeId, p.projects_v2.node_id))];
      }
      return [];
    }

    default:
      // ping, push (Phase 4), sub_issues / issue_dependencies / label (reconcile refreshes), …
      return [];
  }
}

async function isProjectTarget(db: Db, projectNodeId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: ghSyncTargets.nodeId })
    .from(ghSyncTargets)
    .where(and(eq(ghSyncTargets.kind, "project"), eq(ghSyncTargets.nodeId, projectNodeId)));
  return row !== undefined;
}
