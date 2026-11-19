/**
 * Docs on GitHub (decisions 011, 035, 036): read a docs folder's tree, read file bytes, and commit.
 *
 * - The tree: one GraphQL call gives the branch head and the folder's tree oid; when the oid
 *   changed, one REST call lists the folder recursively. The cache keeps paths and blob shas.
 * - Text is cached by blob sha (content-addressed, so it never goes stale).
 * - Every commit is `createCommitOnBranch`: GitHub signs it, it takes several files at once, and
 *   `expectedHeadOid` refuses to commit on top of a head we did not see.
 */
import { bytesToText, decodeBase64, MAX_EDITABLE_BYTES, normalizeDocPath } from "@gitwork/core";
import { type Db, ghDocBlobs, ghDocFiles, ghDocRoots } from "@gitwork/db";
import { eq } from "drizzle-orm";
import { deleteDocFiles, putDocBlob, touchDocRoot, upsertDocFiles, upsertDocRoot } from "./cache";
import type { GitHubAuth, GitHubClient } from "./client";

/** A docs folder with more files than this is listed in part (`truncated`). */
export const MAX_DOC_FILES = 2000;
/** Files above this are not proxied; the tree links to GitHub instead. */
export const MAX_RAW_BYTES = 25_000_000;

export interface DocRootRef {
  id: string;
  repoNodeId: string;
  /** "owner/name" */
  fullName: string;
  branch: string;
  path: string;
  installationId: number;
}

export function docRootId(repoNodeId: string, branch: string, path: string): string {
  return `${repoNodeId}:${branch}:${path}`;
}

type Write = Parameters<Db["batch"]>[0][number];

const DOC_HEAD = `
  query DocHead($owner: String!, $name: String!, $ref: String!, $expr: String!) {
    repository(owner: $owner, name: $name) {
      ref(qualifiedName: $ref) { target { oid } }
      object(expression: $expr) { __typename oid }
    }
  }
`;

export interface DocHead {
  /** The branch head commit, or null when the branch does not exist. */
  headOid: string | null;
  /** The object at the path: a tree for a folder, a blob for a file, or null. */
  object: { type: "Tree" | "Blob" | string; oid: string } | null;
}

/** The branch head and the object at `path` on it, in one call. */
export async function readHead(client: GitHubClient, auth: GitHubAuth, fullName: string, branch: string, path: string): Promise<DocHead> {
  const [owner, name] = fullName.split("/") as [string, string];
  const data = await client.graphql<{
    repository: { ref: { target: { oid: string } } | null; object: { __typename: string; oid: string } | null } | null;
  }>(auth, DOC_HEAD, { owner, name, ref: `refs/heads/${branch}`, expr: `${branch}:${path}` }, { allowNotFound: true });
  const repo = data.repository;
  return {
    headOid: repo?.ref?.target.oid ?? null,
    object: repo?.object ? { type: repo.object.__typename, oid: repo.object.oid } : null,
  };
}

interface TreeJson {
  sha: string;
  truncated: boolean;
  tree: { path: string; type: string; sha: string; size?: number }[];
}

/**
 * The writes that bring one docs folder's cache up to date with GitHub, or [] when nothing
 * changed. The root row comes last, so a batch cut short is retried on the next run.
 */
export async function planDocRootSync(db: Db, client: GitHubClient, root: DocRootRef, now: Date): Promise<Write[]> {
  const auth = { installationId: root.installationId };
  const head = await readHead(client, auth, root.fullName, root.branch, root.path);
  const treeOid = head.object?.type === "Tree" ? head.object.oid : null;
  const [stored] = await db.select().from(ghDocRoots).where(eq(ghDocRoots.id, root.id));
  const rootRow = { id: root.id, repoNodeId: root.repoNodeId, branch: root.branch, path: root.path, headOid: head.headOid, treeOid, syncedAt: now };
  if (stored?.syncedAt && stored.treeOid === treeOid && !stored.truncated) {
    return [touchDocRoot(db, root.id, head.headOid, now)];
  }

  let files: { path: string; blobSha: string; size: number }[] = [];
  let truncated = false;
  if (treeOid) {
    const tree = await client.rest<TreeJson>("GET", `/repos/${root.fullName}/git/trees/${treeOid}?recursive=1`, auth);
    for (const entry of tree.tree) {
      if (entry.type !== "blob") continue;
      const path = normalizeDocPath(`${root.path}/${entry.path}`);
      if (!path) continue; // a name we would refuse to write is not shown either
      files.push({ path, blobSha: entry.sha, size: entry.size ?? 0 });
    }
    truncated = tree.truncated || files.length > MAX_DOC_FILES;
    files = files.slice(0, MAX_DOC_FILES);
  }

  const existing = await db.select({ path: ghDocFiles.path, blobSha: ghDocFiles.blobSha }).from(ghDocFiles).where(eq(ghDocFiles.rootId, root.id));
  const before = new Map(existing.map((f) => [f.path, f.blobSha]));
  const keep = new Set(files.map((f) => f.path));
  const removed = existing.filter((f) => !keep.has(f.path)).map((f) => f.path);
  const changed = files.filter((f) => before.get(f.path) !== f.blobSha);

  const writes: Write[] = [];
  if (removed.length > 0) writes.push(deleteDocFiles(db, root.id, removed));
  for (let i = 0; i < changed.length; i += 20) writes.push(upsertDocFiles(db, root.id, changed.slice(i, i + 20)));
  writes.push(upsertDocRoot(db, { ...rootRow, truncated }));
  return writes;
}

interface BlobJson {
  content: string;
  encoding: string;
  size: number;
}

/** A file's bytes by blob sha. */
export async function readBlobBytes(client: GitHubClient, auth: GitHubAuth, fullName: string, sha: string): Promise<Uint8Array> {
  const blob = await client.rest<BlobJson>("GET", `/repos/${fullName}/git/blobs/${sha}`, auth);
  if (blob.encoding !== "base64") throw new Error(`unexpected blob encoding ${blob.encoding}`);
  return decodeBase64(blob.content);
}

export interface DocText {
  /** Null when the file is not valid UTF-8 or is too large to edit. */
  text: string | null;
  size: number;
}

/** A doc's text, from the cache or GitHub. Cached only when it can be edited. */
export async function readDocText(db: Db, client: GitHubClient, auth: GitHubAuth, fullName: string, sha: string, now: Date): Promise<DocText> {
  const [cached] = await db.select().from(ghDocBlobs).where(eq(ghDocBlobs.sha, sha));
  if (cached) return { text: cached.text, size: cached.size };
  const bytes = await readBlobBytes(client, auth, fullName, sha);
  const text = bytes.length <= MAX_EDITABLE_BYTES ? bytesToText(bytes) : null;
  if (text !== null) await putDocBlob(db, { sha, text, size: bytes.length, fetchedAt: now });
  return { text, size: bytes.length };
}

/** The git blob id of some bytes: sha1("blob <len>\0" + bytes). Lets a save skip a no-op commit. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const COMMIT_FILES = `
  mutation CommitFiles($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) { commit { oid url } }
  }
`;

export interface FileChanges {
  additions: { path: string; contents: string /* base64 */ }[];
  deletions: { path: string }[];
}

/** One signed commit with several file changes, only on top of `expectedHeadOid`. */
export async function commitFiles(
  client: GitHubClient,
  auth: GitHubAuth,
  input: { fullName: string; branch: string; expectedHeadOid: string; headline: string; body?: string; changes: FileChanges },
): Promise<{ oid: string; url: string }> {
  const out = await client.graphql<{ createCommitOnBranch: { commit: { oid: string; url: string } } }>(auth, COMMIT_FILES, {
    input: {
      branch: { repositoryNameWithOwner: input.fullName, branchName: input.branch },
      message: { headline: input.headline, ...(input.body ? { body: input.body } : {}) },
      fileChanges: input.changes,
      expectedHeadOid: input.expectedHeadOid,
    },
  });
  return out.createCommitOnBranch.commit;
}

/** A new branch at `sha`. */
export async function createBranch(client: GitHubClient, auth: GitHubAuth, fullName: string, branch: string, sha: string) {
  await client.rest("POST", `/repos/${fullName}/git/refs`, auth, { ref: `refs/heads/${branch}`, sha });
}

export async function openPullRequest(
  client: GitHubClient,
  auth: GitHubAuth,
  input: { fullName: string; head: string; base: string; title: string; body: string },
): Promise<{ number: number; html_url: string }> {
  return client.rest("POST", `/repos/${input.fullName}/pulls`, auth, { title: input.title, head: input.head, base: input.base, body: input.body });
}
