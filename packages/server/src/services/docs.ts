/**
 * Docs (decisions 008, 011, 012, 035, 036). Reads come from the cache and pass every path through
 * `isDocVisible` in packages/core. Writes are one signed commit each: the user's own token first,
 * the App on "access denied". A save checks the file's blob sha first: a changed file is a conflict.
 * A commit GitHub refuses on an unchanged file is branch protection: the save becomes a pull request.
 */
import {
  type DocVisibilityContext,
  MAX_EDITABLE_BYTES,
  docVisibilityContext,
  encodeBase64,
  imageType,
  isDocVisible,
  isMarkdownPath,
  normalizeDocPath,
  normalizeRoot,
  DEFAULT_DOCS_ROOT,
  relativeToRoot,
  textToBytes,
} from "@gitwork/core";
import { type Db, docPendingPrs, docPresence, ghDocFiles, ghDocRoots, ghRepos, users, workspaceGithub, workspaceRepos } from "@gitwork/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { randomToken } from "../crypto";
import { ServiceError, badRequest, conflict, notFound } from "../errors";
import { putDocBlob, pruneDocBlobs } from "../github/cache";
import { type GitHubAuth, GitHubError, GitHubRateLimitError, isAccessDenied } from "../github/client";
import {
  type DocRootRef,
  type FileChanges,
  MAX_RAW_BYTES,
  commitFiles,
  createBranch,
  docRootId,
  gitBlobSha,
  openPullRequest,
  planDocRootSync,
  readBlobBytes,
  readDocText,
  readHead,
} from "../github/docs";
import { userGitHubToken } from "../github/user-token";
import { auditInsert } from "./audit";
import { type WorkspaceAccess, requireCapability } from "./access";
import type { GitHubServiceDeps } from "./link";

type Write = Parameters<Db["batch"]>[0][number];
type Via = "user" | "app";

/** Decision 011: images up to 10 MB, committed with the doc. */
export const MAX_IMAGE_BYTES = 10_000_000;
export const MAX_ATTACHMENTS = 5;
const PRESENCE_TTL_MS = 45_000;

// ---- Repos and roots --------------------------------------------------------------------------

export interface DocRepo extends DocRootRef {
  /** False when the App can no longer reach the repo. */
  available: boolean;
  archived: boolean;
  /** Whether the branch is the repo's default (the setting is empty). */
  defaultBranch: boolean;
}

/** The workspace's repos with their docs folder and branch. Cache only. */
export async function workspaceDocRepos(db: Db, workspaceId: string): Promise<DocRepo[]> {
  const rows = await db
    .select({
      repoNodeId: workspaceRepos.repoNodeId,
      docsPath: workspaceRepos.docsPath,
      docsBranch: workspaceRepos.docsBranch,
      fullName: ghRepos.fullName,
      repoDefault: ghRepos.defaultBranch,
      available: ghRepos.available,
      archived: ghRepos.archived,
      installationId: ghRepos.installationId,
    })
    .from(workspaceRepos)
    .innerJoin(ghRepos, eq(ghRepos.nodeId, workspaceRepos.repoNodeId))
    .innerJoin(workspaceGithub, eq(workspaceGithub.workspaceId, workspaceRepos.workspaceId))
    .where(eq(workspaceRepos.workspaceId, workspaceId));
  return rows.map((r) => {
    const branch = r.docsBranch ?? r.repoDefault ?? "main";
    const path = normalizeRoot(r.docsPath) ?? DEFAULT_DOCS_ROOT;
    return {
      id: docRootId(r.repoNodeId, branch, path),
      repoNodeId: r.repoNodeId,
      fullName: r.fullName,
      branch,
      path,
      installationId: r.installationId,
      available: r.available,
      archived: r.archived,
      defaultBranch: r.docsBranch === null,
    };
  });
}

/** Every docs folder any workspace uses: what reconcile keeps current. */
export async function allDocRoots(db: Db, repoNodeId?: string): Promise<DocRootRef[]> {
  const rows = await db
    .selectDistinct({
      repoNodeId: workspaceRepos.repoNodeId,
      docsPath: workspaceRepos.docsPath,
      docsBranch: workspaceRepos.docsBranch,
      fullName: ghRepos.fullName,
      repoDefault: ghRepos.defaultBranch,
      installationId: ghRepos.installationId,
    })
    .from(workspaceRepos)
    .innerJoin(ghRepos, eq(ghRepos.nodeId, workspaceRepos.repoNodeId))
    .innerJoin(workspaceGithub, eq(workspaceGithub.workspaceId, workspaceRepos.workspaceId))
    .where(and(eq(ghRepos.available, true), repoNodeId ? eq(workspaceRepos.repoNodeId, repoNodeId) : undefined));
  const seen = new Map<string, DocRootRef>();
  for (const r of rows) {
    const branch = r.docsBranch ?? r.repoDefault ?? "main";
    const path = normalizeRoot(r.docsPath) ?? DEFAULT_DOCS_ROOT;
    const id = docRootId(r.repoNodeId, branch, path);
    seen.set(id, { id, repoNodeId: r.repoNodeId, fullName: r.fullName, branch, path, installationId: r.installationId });
  }
  return [...seen.values()];
}

async function batch(db: Db, writes: Write[]) {
  for (let i = 0; i < writes.length; i += 100) {
    const chunk = writes.slice(i, i + 100);
    if (chunk.length) await db.batch(chunk as unknown as Parameters<Db["batch"]>[0]);
  }
}

/** Syncs these docs folders now (bounded), then drops cache rows nothing uses. */
export async function syncDocRoots(deps: Pick<GitHubServiceDeps, "db" | "client">, roots: DocRootRef[], now = new Date()) {
  const synced: string[] = [];
  const failed: { root: string; error: string }[] = [];
  for (const root of roots.slice(0, 20)) {
    try {
      await batch(deps.db, await planDocRootSync(deps.db, deps.client, root, now));
      synced.push(root.id);
    } catch (error) {
      if (error instanceof GitHubRateLimitError) throw error;
      failed.push({ root: root.id, error: (error as Error).message });
    }
  }
  return { synced, failed };
}

/** Roots no workspace uses any more, their files, and text no file points at. */
export async function pruneDocCache(db: Db) {
  const used = new Set((await allDocRoots(db)).map((r) => r.id));
  const stored = await db.select({ id: ghDocRoots.id }).from(ghDocRoots);
  const stale = stored.map((r) => r.id).filter((id) => !used.has(id));
  const writes: Write[] = [];
  for (const id of stale) writes.push(db.delete(ghDocFiles).where(eq(ghDocFiles.rootId, id)), db.delete(ghDocRoots).where(eq(ghDocRoots.id, id)));
  writes.push(pruneDocBlobs(db));
  await batch(db, writes);
}

// ---- Reads ------------------------------------------------------------------------------------

export type FileKind = "doc" | "image" | "file";

export interface DocFileView {
  path: string;
  size: number;
  kind: FileKind;
  /** An open pull request holds edits to this doc. */
  pending: { number: number; url: string } | null;
}

export interface DocRepoView {
  repoNodeId: string;
  fullName: string;
  root: string;
  branch: string;
  /** "ok", "unsynced" (not read from GitHub yet), "missing" (no such folder), "unavailable". */
  status: "ok" | "unsynced" | "missing" | "unavailable";
  truncated: boolean;
  files: DocFileView[];
}

export function fileKind(path: string): FileKind {
  return isMarkdownPath(path) ? "doc" : imageType(path) ? "image" : "file";
}

function viewContext(access: WorkspaceAccess): DocVisibilityContext {
  return docVisibilityContext(access.actor, access.settings, access.workspace.hideFolder);
}

/** Every visible file in every linked repo's docs folder. Cache only. */
export async function listDocs(db: Db, access: WorkspaceAccess): Promise<{ linked: boolean; repos: DocRepoView[] }> {
  requireCapability(access, "workspace.view");
  const repos = await workspaceDocRepos(db, access.workspace.id);
  const [link] = await db.select({ id: workspaceGithub.workspaceId }).from(workspaceGithub).where(eq(workspaceGithub.workspaceId, access.workspace.id));
  if (!link) return { linked: false, repos: [] };
  const ctx = viewContext(access);
  const out: DocRepoView[] = [];
  for (const repo of repos) {
    const base = { repoNodeId: repo.repoNodeId, fullName: repo.fullName, root: repo.path, branch: repo.branch, truncated: false, files: [] };
    if (!repo.available) {
      out.push({ ...base, status: "unavailable" });
      continue;
    }
    const [root] = await db.select().from(ghDocRoots).where(eq(ghDocRoots.id, repo.id));
    if (!root?.syncedAt) {
      out.push({ ...base, status: "unsynced" });
      continue;
    }
    if (!root.treeOid) {
      out.push({ ...base, status: "missing" });
      continue;
    }
    const [files, pending] = await Promise.all([
      db.select().from(ghDocFiles).where(eq(ghDocFiles.rootId, repo.id)),
      db.select().from(docPendingPrs).where(and(eq(docPendingPrs.repoNodeId, repo.repoNodeId), eq(docPendingPrs.baseBranch, repo.branch))),
    ]);
    const pendingOf = new Map(pending.map((p) => [p.path, { number: p.prNumber, url: p.prUrl }]));
    out.push({
      ...base,
      status: "ok",
      // Read Only must not learn that hidden files exist, so a truncated listing says nothing more.
      truncated: root.truncated,
      files: files
        .filter((f) => isDocVisible(f.path, repo.path, ctx))
        .map((f) => ({ path: f.path, size: f.size, kind: fileKind(f.path), pending: pendingOf.get(f.path) ?? null }))
        .concat(
          // A new doc whose first save became a pull request exists only on the PR branch.
          pending
            .filter((p) => !files.some((f) => f.path === p.path) && isDocVisible(p.path, repo.path, ctx))
            .map((p) => ({ path: p.path, size: 0, kind: "doc" as const, pending: { number: p.prNumber, url: p.prUrl } })),
        )
        .sort((a, b) => a.path.localeCompare(b.path)),
    });
  }
  return { linked: true, repos: out };
}

/** The repo and a checked path, or 404 for anything this viewer may not see. */
async function resolveFile(db: Db, access: WorkspaceAccess, repoNodeId: string, rawPath: string) {
  requireCapability(access, "workspace.view");
  const repo = (await workspaceDocRepos(db, access.workspace.id)).find((r) => r.repoNodeId === repoNodeId);
  const path = normalizeDocPath(rawPath);
  if (!repo || !repo.available || !path || !isDocVisible(path, repo.path, viewContext(access))) throw notFound("Doc not found.");
  return { repo, path };
}

async function pendingFor(db: Db, repo: DocRepo, path: string): Promise<typeof docPendingPrs.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(docPendingPrs)
    .where(and(eq(docPendingPrs.repoNodeId, repo.repoNodeId), eq(docPendingPrs.baseBranch, repo.branch), eq(docPendingPrs.path, path)));
  return row ?? null;
}

export interface Editor {
  userId: string;
  name: string;
}

async function editorsOf(db: Db, access: WorkspaceAccess, repoNodeId: string, path: string, now: Date): Promise<Editor[]> {
  const rows = await db
    .select({ userId: docPresence.userId, name: users.name, email: users.email })
    .from(docPresence)
    .innerJoin(users, eq(users.id, docPresence.userId))
    .where(
      and(
        eq(docPresence.workspaceId, access.workspace.id),
        eq(docPresence.repoNodeId, repoNodeId),
        eq(docPresence.path, path),
        gt(docPresence.expiresAt, now),
      ),
    );
  return rows.filter((r) => r.userId !== access.userId).map((r) => ({ userId: r.userId, name: r.name?.trim() || r.email }));
}

export interface DocView {
  repoNodeId: string;
  fullName: string;
  path: string;
  /** Relative to the docs folder, for display. */
  name: string;
  /** The docs root ("" = the whole repo, decision 038). */
  root: string;
  branch: string;
  /** The blob sha the text came from: send it back with a save. */
  sha: string;
  /** Null when the file is not valid UTF-8 or is over the editable size. */
  text: string | null;
  size: number;
  editable: boolean;
  canDelete: boolean;
  /** Saves go to this pull request's branch until it closes. */
  pending: { number: number; url: string; branch: string } | null;
  editors: Editor[];
}

/** One doc's text. May call GitHub for text not cached yet: API routes only, never a page render. */
export async function getDoc(deps: GitHubServiceDeps, access: WorkspaceAccess, repoNodeId: string, rawPath: string, now = new Date()): Promise<DocView> {
  const { db } = deps;
  const { repo, path } = await resolveFile(db, access, repoNodeId, rawPath);
  if (!isMarkdownPath(path)) throw notFound("Doc not found.");
  let pending = await pendingFor(db, repo, path);
  const auth = { installationId: repo.installationId };
  let sha: string | null = null;
  if (pending) {
    const head = await readHead(deps.client, auth, repo.fullName, pending.headBranch, path);
    if (head.object?.type === "Blob") sha = head.object.oid;
    if (!head.headOid) {
      // The branch is gone (merged or closed, webhook missed): the doc is no longer pending.
      await db.delete(docPendingPrs).where(and(eq(docPendingPrs.repoNodeId, repo.repoNodeId), eq(docPendingPrs.prNumber, pending.prNumber)));
      pending = null;
    }
  }
  if (!sha) {
    const [file] = await db.select().from(ghDocFiles).where(and(eq(ghDocFiles.rootId, repo.id), eq(ghDocFiles.path, path)));
    if (!file) throw notFound("Doc not found.");
    sha = file.blobSha;
  }
  const { text, size } = await readDocText(db, deps.client, auth, repo.fullName, sha, now);
  const canWrite = can(access, "docs.write");
  return {
    repoNodeId: repo.repoNodeId,
    fullName: repo.fullName,
    path,
    name: relativeToRoot(path, repo.path),
    root: repo.path,
    branch: pending?.headBranch ?? repo.branch,
    sha,
    text,
    size,
    editable: canWrite && text !== null && size <= MAX_EDITABLE_BYTES && !repo.archived,
    canDelete: can(access, "docs.delete") && !repo.archived && !pending,
    pending: pending ? { number: pending.prNumber, url: pending.prUrl, branch: pending.headBranch } : null,
    editors: await editorsOf(db, access, repo.repoNodeId, path, now),
  };
}

function can(access: WorkspaceAccess, capability: Parameters<typeof requireCapability>[1]): boolean {
  try {
    requireCapability(access, capability);
    return true;
  } catch {
    return false;
  }
}

/** An image or other file in a docs folder, served after the same checks as a doc (decision 012). */
export async function rawDocFile(deps: GitHubServiceDeps, access: WorkspaceAccess, repoNodeId: string, rawPath: string): Promise<Response> {
  const { db } = deps;
  const { repo, path } = await resolveFile(db, access, repoNodeId, rawPath);
  const [file] = await db.select().from(ghDocFiles).where(and(eq(ghDocFiles.rootId, repo.id), eq(ghDocFiles.path, path)));
  if (!file) throw notFound("File not found.");
  if (file.size > MAX_RAW_BYTES) throw new ServiceError(409, "too_large", "This file is too large to open here. Open it on GitHub.");
  const bytes = await readBlobBytes(deps.client, { installationId: repo.installationId }, repo.fullName, file.blobSha);
  const type = imageType(path);
  const name = path.split("/").pop()!.replace(/["\\\r\n]/g, "_");
  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": type ?? "application/octet-stream",
      // Inline only for images; SVG runs no script under this policy, even when opened directly.
      "content-disposition": `${type ? "inline" : "attachment"}; filename="${name}"`,
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=300",
      etag: `"${file.blobSha}"`,
    },
  });
}

// ---- Presence ---------------------------------------------------------------------------------

/** "I have this doc open." Returns the other people who do. */
export async function heartbeat(db: Db, access: WorkspaceAccess, repoNodeId: string, rawPath: string, now = new Date()): Promise<Editor[]> {
  const { repo, path } = await resolveFile(db, access, repoNodeId, rawPath);
  requireCapability(access, "docs.write");
  const expiresAt = new Date(now.getTime() + PRESENCE_TTL_MS);
  await db.batch([
    db
      .insert(docPresence)
      .values({ workspaceId: access.workspace.id, repoNodeId: repo.repoNodeId, path, userId: access.userId, expiresAt })
      .onConflictDoUpdate({ target: [docPresence.workspaceId, docPresence.repoNodeId, docPresence.path, docPresence.userId], set: { expiresAt } }),
    // Old rows from anyone: presence is short-lived, nothing else reads them.
    db.delete(docPresence).where(sql`${docPresence.expiresAt} < ${now.getTime() - PRESENCE_TTL_MS}`),
  ]);
  return editorsOf(db, access, repo.repoNodeId, path, now);
}

export async function leave(db: Db, access: WorkspaceAccess, repoNodeId: string, rawPath: string) {
  const { repo, path } = await resolveFile(db, access, repoNodeId, rawPath);
  await db
    .delete(docPresence)
    .where(
      and(
        eq(docPresence.workspaceId, access.workspace.id),
        eq(docPresence.repoNodeId, repo.repoNodeId),
        eq(docPresence.path, path),
        eq(docPresence.userId, access.userId),
      ),
    );
}

// ---- Writes -----------------------------------------------------------------------------------

export interface DocWriteDeps extends GitHubServiceDeps {
  /** For the Co-authored-by trailer on App commits (decision 008). */
  author: { name: string; email: string };
}

export type WriteResult =
  | { status: "committed"; commitSha: string; sha: string | null }
  | { status: "pending_review"; pr: { number: number; url: string; branch: string }; sha: string | null }
  | { status: "unchanged"; sha: string };

interface WritePlan {
  action: "doc.save" | "doc.create" | "doc.rename" | "doc.delete";
  repo: DocRepo;
  /** The doc the write is about (the new path for a rename). */
  path: string;
  headline: string;
  /** Files whose current blob sha must match before committing. null = must not exist. */
  expect: { path: string; sha: string | null }[];
  changes: FileChanges;
  /** Blob shas of the new text, for the cache. */
  newText?: { sha: string; text: string; size: number };
  detail?: Record<string, unknown>;
}

async function writeContext(deps: DocWriteDeps, access: WorkspaceAccess, repoNodeId: string, rawPath: string, capability: "docs.write" | "docs.delete" = "docs.write") {
  requireCapability(access, capability);
  const { repo, path } = await resolveFile(deps.db, access, repoNodeId, rawPath);
  if (repo.archived) throw conflict("repo_archived", "This repo is archived on GitHub.");
  return { repo, path };
}

/** Throws a 409 with the file's current text when it is not what the client last saw. */
async function checkExpectations(deps: DocWriteDeps, repo: DocRepo, branch: string, expect: WritePlan["expect"], auth: GitHubAuth, now: Date) {
  let headOid: string | null = null;
  for (const e of expect) {
    const head = await readHead(deps.client, auth, repo.fullName, branch, e.path);
    if (!head.headOid) throw conflict("branch_missing", `The branch "${branch}" does not exist on GitHub.`);
    headOid ??= head.headOid;
    const current = head.object?.type === "Blob" ? head.object.oid : null;
    if (current === e.sha) continue;
    if (e.sha === null) throw conflict("doc_exists", "A file with that name already exists.");
    if (current === null) throw conflict("doc_gone", "Someone deleted or moved this doc on GitHub.");
    const { text } = await readDocText(deps.db, deps.client, auth, repo.fullName, current, now);
    throw conflict("doc_conflict", "Someone changed this doc on GitHub since you opened it.", { current: { sha: current, text } });
  }
  return headOid!;
}

function commitBody(deps: DocWriteDeps, via: Via): string | undefined {
  // App commits name the person; GitHub keeps them verified (decision 008).
  return via === "app" ? `Edited in Gitwork.\n\nCo-authored-by: ${deps.author.name} <${deps.author.email}>` : undefined;
}

/** The user's token, then the App on "access denied" (decision 021). */
async function asActor<T>(token: string | null, installationId: number, call: (auth: GitHubAuth, via: Via) => Promise<T>, appOnly = false) {
  if (token && !appOnly) {
    try {
      return { result: await call({ userToken: token }, "user"), via: "user" as Via };
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
    }
  }
  return { result: await call({ installationId }, "app"), via: "app" as Via };
}

/** GitHub refused the commit itself (not a rate limit or an outage). */
function isRefusal(error: unknown): boolean {
  if (!(error instanceof GitHubError) || error instanceof GitHubRateLimitError) return false;
  return error.status < 500;
}

function prBranchName(path: string): string {
  const slug = (path.split("/").pop() ?? "doc").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `gitwork/docs-${slug || "doc"}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
}

async function execute(deps: DocWriteDeps, access: WorkspaceAccess, plan: WritePlan, now: () => Date): Promise<WriteResult> {
  const { db } = deps;
  const { repo } = plan;
  const readAuth = { installationId: repo.installationId };
  const pending = plan.action === "doc.save" ? await pendingFor(db, repo, plan.path) : null;
  const branch = pending?.headBranch ?? repo.branch;
  const token = await userGitHubToken({ db, auth: deps.auth }, access.userId);
  // Review mode: App writes become pull requests (decision 008). The user's own writes do not.
  const reviewApp = access.workspace.reviewBotDocEdits && !token;

  const audit = async (via: Via, extra: { commitSha?: string; detail?: Record<string, unknown> }, writes: Write[] = []) => {
    const at = now();
    await batch(db, [
      ...writes,
      ...(plan.newText ? [putDocBlob(db, { ...plan.newText, fetchedAt: at })] : []),
      auditInsert(
        db,
        {
          userId: access.userId,
          workspaceId: access.workspace.id,
          action: plan.action,
          via,
          repoNodeId: repo.repoNodeId,
          target: plan.path,
          commitSha: extra.commitSha ?? null,
          detail: { ...plan.detail, ...extra.detail },
        },
        at,
      ),
    ]);
  };

  // Try a direct commit; a lost race with another commit retries once.
  if (!reviewApp && !pending) {
    let refused = false;
    for (let attempt = 0; attempt < 2 && !refused; attempt++) {
      const headOid = await checkExpectations(deps, repo, branch, plan.expect, readAuth, now());
      try {
        const { result, via } = await asActor(token, repo.installationId, (auth, via) =>
          commitFiles(deps.client, auth, { fullName: repo.fullName, branch, expectedHeadOid: headOid, headline: plan.headline, body: commitBody(deps, via), changes: plan.changes }),
        );
        // Refresh the tree from GitHub, so the cache holds exactly what was committed.
        const writes = await planDocRootSync(db, deps.client, repo, now());
        await audit(via, { commitSha: result.oid }, writes);
        return { status: "committed", commitSha: result.oid, sha: plan.newText?.sha ?? null };
      } catch (error) {
        if (!isRefusal(error)) throw error;
        const head = await readHead(deps.client, readAuth, repo.fullName, branch, plan.path);
        if (head.headOid !== headOid) continue; // someone committed meanwhile: check again
        // Same head, same files, still refused: branch protection or a ruleset.
        refused = true;
      }
    }
    if (!refused) throw conflict("doc_busy", "Others are committing to this branch right now. Try again.");
  }

  // Saves to a doc that already has a pull request go to its branch.
  if (pending) {
    const headOid = await checkExpectations(deps, repo, branch, plan.expect, readAuth, now());
    const { result, via } = await asActor(token, repo.installationId, (auth, via) =>
      commitFiles(deps.client, auth, { fullName: repo.fullName, branch, expectedHeadOid: headOid, headline: plan.headline, body: commitBody(deps, via), changes: plan.changes }),
    );
    await audit(via, { commitSha: result.oid, detail: { pr: pending.prNumber } });
    return { status: "pending_review", pr: { number: pending.prNumber, url: pending.prUrl, branch }, sha: plan.newText?.sha ?? null };
  }

  // A pull request from a new branch at the head we checked.
  const headOid = await checkExpectations(deps, repo, repo.branch, plan.expect, readAuth, now());
  const prBranch = prBranchName(plan.path);
  const reason = reviewApp
    ? "This workspace requires review for edits from people without GitHub."
    : `GitHub did not allow a direct commit to \`${repo.branch}\` (branch protection or a ruleset).`;
  const { result, via } = await asActor(
    token,
    repo.installationId,
    async (auth, via) => {
      await createBranch(deps.client, auth, repo.fullName, prBranch, headOid);
      const commit = await commitFiles(deps.client, auth, {
        fullName: repo.fullName,
        branch: prBranch,
        expectedHeadOid: headOid,
        headline: plan.headline,
        body: commitBody(deps, via),
        changes: plan.changes,
      });
      const pr = await openPullRequest(deps.client, auth, {
        fullName: repo.fullName,
        head: prBranch,
        base: repo.branch,
        title: plan.headline,
        body: `${reason}\n\nEdited by ${deps.author.name} in Gitwork.`,
      });
      return { commit, pr };
    },
    reviewApp,
  );
  const writes: Write[] =
    plan.action === "doc.save" || plan.action === "doc.create"
      ? [
          db
            .insert(docPendingPrs)
            .values({ repoNodeId: repo.repoNodeId, baseBranch: repo.branch, path: plan.path, headBranch: prBranch, prNumber: result.pr.number, prUrl: result.pr.html_url, createdBy: access.userId })
            .onConflictDoUpdate({
              target: [docPendingPrs.repoNodeId, docPendingPrs.baseBranch, docPendingPrs.path],
              set: { headBranch: prBranch, prNumber: result.pr.number, prUrl: result.pr.html_url, createdBy: access.userId },
            }),
        ]
      : [];
  await audit(via, { commitSha: result.commit.oid, detail: { pr: result.pr.number, reason: reviewApp ? "review_mode" : "protected" } }, writes);
  return { status: "pending_review", pr: { number: result.pr.number, url: result.pr.html_url, branch: prBranch }, sha: plan.newText?.sha ?? null };
}

export interface Attachment {
  /** Repo-relative path inside the docs folder. */
  path: string;
  /** Base64 bytes. */
  data: string;
}

async function attachmentChanges(repo: DocRepo, access: WorkspaceAccess, attachments: Attachment[] | undefined) {
  const list = attachments ?? [];
  if (list.length > MAX_ATTACHMENTS) throw badRequest(`Attach at most ${MAX_ATTACHMENTS} images per save.`);
  const out: FileChanges["additions"] = [];
  const expect: WritePlan["expect"] = [];
  const ctx = docVisibilityContext(access.actor, access.settings, access.workspace.hideFolder);
  for (const a of list) {
    const path = normalizeDocPath(a.path);
    if (!path || !imageType(path) || !isDocVisible(path, repo.path, ctx)) throw badRequest("Images must go inside the docs folder.");
    // base64 length → bytes, without decoding twice.
    const bytes = Math.floor((a.data.replace(/=+$/, "").length * 3) / 4);
    if (bytes > MAX_IMAGE_BYTES) throw badRequest("Images can be at most 10 MB.");
    out.push({ path, contents: a.data.replace(/\s+/g, "") });
    expect.push({ path, sha: null });
  }
  return { additions: out, expect };
}

export interface SaveDocInput {
  repoNodeId: string;
  path: string;
  /** The blob sha the client loaded (DocView.sha). */
  baseSha: string;
  text: string;
  attachments?: Attachment[];
  message?: string;
}

export async function saveDoc(deps: DocWriteDeps, access: WorkspaceAccess, input: SaveDocInput, now = () => new Date()): Promise<WriteResult> {
  const { repo, path } = await writeContext(deps, access, input.repoNodeId, input.path);
  if (!isMarkdownPath(path)) throw badRequest("Only markdown files can be edited.");
  const bytes = textToBytes(input.text);
  if (bytes.length > MAX_EDITABLE_BYTES) throw badRequest("This doc is too large to save here.");
  const sha = await gitBlobSha(bytes);
  const images = await attachmentChanges(repo, access, input.attachments);
  if (sha === input.baseSha && images.additions.length === 0) return { status: "unchanged", sha };
  return execute(
    deps,
    access,
    {
      action: "doc.save",
      repo,
      path,
      headline: input.message?.trim() || `Update ${relativeToRoot(path, repo.path)}`,
      expect: [{ path, sha: input.baseSha }, ...images.expect],
      changes: { additions: [{ path, contents: encodeBase64(bytes) }, ...images.additions], deletions: [] },
      newText: { sha, text: input.text, size: bytes.length },
      detail: images.additions.length ? { images: images.additions.map((a) => a.path) } : undefined,
    },
    now,
  );
}

export async function createDoc(deps: DocWriteDeps, access: WorkspaceAccess, input: { repoNodeId: string; path: string; text?: string }, now = () => new Date()) {
  const { repo, path } = await writeContext(deps, access, input.repoNodeId, input.path);
  if (!isMarkdownPath(path)) throw badRequest("Doc names end in .md.");
  const text = input.text ?? `# ${relativeToRoot(path, repo.path).split("/").pop()!.replace(/\.(md|markdown)$/i, "")}\n`;
  const bytes = textToBytes(text);
  const sha = await gitBlobSha(bytes);
  return execute(
    deps,
    access,
    {
      action: "doc.create",
      repo,
      path,
      headline: `Add ${relativeToRoot(path, repo.path)}`,
      expect: [{ path, sha: null }],
      changes: { additions: [{ path, contents: encodeBase64(bytes) }], deletions: [] },
      newText: { sha, text, size: bytes.length },
    },
    now,
  );
}

/** Rename or move: one commit, so git follows the file (decision 011). */
export async function renameDoc(
  deps: DocWriteDeps,
  access: WorkspaceAccess,
  input: { repoNodeId: string; path: string; baseSha: string; newPath: string },
  now = () => new Date(),
) {
  const { repo, path } = await writeContext(deps, access, input.repoNodeId, input.path);
  const target = normalizeDocPath(input.newPath);
  const ctx = docVisibilityContext(access.actor, access.settings, access.workspace.hideFolder);
  if (!target || !isMarkdownPath(target) || !isDocVisible(target, repo.path, ctx)) throw badRequest("Pick a .md name inside the docs folder.");
  if (target === path) throw badRequest("That is the current name.");
  if (await pendingFor(deps.db, repo, path)) throw conflict("doc_pending", "This doc has an open pull request. Rename it after the review.");
  const bytes = await readBlobBytes(deps.client, { installationId: repo.installationId }, repo.fullName, input.baseSha);
  return execute(
    deps,
    access,
    {
      action: "doc.rename",
      repo,
      path: target,
      headline: `Rename ${relativeToRoot(path, repo.path)} to ${relativeToRoot(target, repo.path)}`,
      expect: [
        { path, sha: input.baseSha },
        { path: target, sha: null },
      ],
      changes: { additions: [{ path: target, contents: encodeBase64(bytes) }], deletions: [{ path }] },
      detail: { from: path },
    },
    now,
  );
}

export async function deleteDoc(deps: DocWriteDeps, access: WorkspaceAccess, input: { repoNodeId: string; path: string; baseSha: string }, now = () => new Date()) {
  const { repo, path } = await writeContext(deps, access, input.repoNodeId, input.path, "docs.delete");
  if (await pendingFor(deps.db, repo, path)) throw conflict("doc_pending", "This doc has an open pull request. Delete it after the review.");
  return execute(
    deps,
    access,
    {
      action: "doc.delete",
      repo,
      path,
      headline: `Delete ${relativeToRoot(path, repo.path)}`,
      expect: [{ path, sha: input.baseSha }],
      changes: { additions: [], deletions: [{ path }] },
    },
    now,
  );
}

// ---- Settings ---------------------------------------------------------------------------------

/** A repo's docs folder and branch for this workspace (decision 011). Admins only. */
export async function setDocsConfig(
  deps: Pick<GitHubServiceDeps, "db" | "client">,
  access: WorkspaceAccess,
  input: { repoNodeId: string; docsPath?: string; docsBranch?: string | null },
  now = new Date(),
) {
  requireCapability(access, "workspace.github_settings");
  const repo = (await workspaceDocRepos(deps.db, access.workspace.id)).find((r) => r.repoNodeId === input.repoNodeId);
  if (!repo) throw notFound("Repo not found.");
  const set: { docsPath?: string; docsBranch?: string | null } = {};
  if (input.docsPath !== undefined) {
    const root = normalizeRoot(input.docsPath);
    if (root === null) throw badRequest("Enter a folder path such as docs, or leave it empty for the whole repo.");
    set.docsPath = root;
  }
  if (input.docsBranch !== undefined) {
    const branch = input.docsBranch?.trim() || null;
    // git check-ref-format, the parts that matter here.
    if (branch && (!/^[\w./-]+$/.test(branch) || /(^[./-])|\.\.|\/\/|[./]$|\.lock$|@\{/.test(branch))) throw badRequest("That is not a valid branch name.");
    set.docsBranch = branch;
  }
  if (Object.keys(set).length === 0) return;
  await deps.db.batch([
    deps.db.update(workspaceRepos).set(set).where(and(eq(workspaceRepos.workspaceId, access.workspace.id), eq(workspaceRepos.repoNodeId, input.repoNodeId))),
    auditInsert(deps.db, { userId: access.userId, workspaceId: access.workspace.id, action: "workspace.docs_config", via: "local", repoNodeId: input.repoNodeId, target: access.workspace.id, detail: set }, now),
  ]);
  const updated = (await workspaceDocRepos(deps.db, access.workspace.id)).find((r) => r.repoNodeId === input.repoNodeId)!;
  await syncDocRoots(deps, [updated], now);
  await pruneDocCache(deps.db);
}

/**
 * Loads repos that were never synced. The tree calls it on its own when it finds one, so docs
 * load without a button (decision 038). Synced roots are skipped: no one can force extra calls.
 */
export async function refreshDocs(deps: Pick<GitHubServiceDeps, "db" | "client">, access: WorkspaceAccess, now = new Date()) {
  requireCapability(access, "workspace.view");
  const repos = (await workspaceDocRepos(deps.db, access.workspace.id)).filter((r) => r.available);
  const synced = new Set(
    (await deps.db.select({ id: ghDocRoots.id, syncedAt: ghDocRoots.syncedAt }).from(ghDocRoots)).filter((r) => r.syncedAt).map((r) => r.id),
  );
  return syncDocRoots(deps, repos.filter((r) => !synced.has(r.id)), now);
}
