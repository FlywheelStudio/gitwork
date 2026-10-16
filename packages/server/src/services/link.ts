/**
 * Linking a workspace to one board and its repos (decisions 006, 020). This is a security
 * boundary: the App's installation token can read every org that installed it, so every choice is
 * re-checked here with the linking user's OWN GitHub token. Nothing from the client is trusted.
 */
import {
  type Db,
  ghProjectFields,
  ghProjects,
  ghRepos,
  ghSyncTargets,
  githubInstallations,
  workspaceGithub,
  workspaceRepos,
} from "@gitwork/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { badRequest, conflict, forbidden } from "../errors";
import { type RepoJson, upsertProject, upsertRepo } from "../github/cache";
import type { GitHubClient } from "../github/client";
import { reconcile } from "../github/reconcile";
import { userGitHubToken, type UserTokenOptions } from "../github/user-token";
import { randomToken } from "../crypto";
import { auditInsert } from "./audit";
import { type WorkspaceAccess, requireCapability } from "./access";

export interface GitHubServiceDeps {
  db: Db;
  client: GitHubClient;
  auth: UserTokenOptions["auth"];
}

/** Bounds on what we page through for one user. */
const MAX_INSTALLATION_PAGES = 5;
const MAX_REPO_PAGES = 20;
export const MAX_LINKED_REPOS = 50;
/** Pages per target for the first sync right after linking (the cron does the rest). */
const FIRST_SYNC_PAGES = 3;

interface UserInstallation {
  id: number;
  account: { login: string; type?: string };
}

const LINK_PROJECT = `
  query LinkProject($id: ID!) {
    node(id: $id) {
      ... on ProjectV2 { id number title closed url owner { ... on Organization { login } ... on User { login } } }
    }
  }
`;

const ORG_PROJECTS = `
  query OrgProjects($login: String!) {
    organization(login: $login) {
      projectsV2(first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { id number title closed } }
    }
  }
`;

async function requireUserToken(deps: GitHubServiceDeps, userId: string): Promise<string> {
  const token = await userGitHubToken({ db: deps.db, auth: deps.auth }, userId);
  if (!token) throw conflict("github_relink", "Link your GitHub account again in Settings, then retry.");
  return token;
}

/** Installations of this App that the user's own GitHub account can see, and that we know of. */
async function userInstallations(deps: GitHubServiceDeps, token: string): Promise<UserInstallation[]> {
  const seen: UserInstallation[] = [];
  let url: string | null = "/user/installations?per_page=100";
  for (let page = 0; url && page < MAX_INSTALLATION_PAGES; page++) {
    const res: { data: { installations?: UserInstallation[] }; next: string | null } = await deps.client.pageOf(url, { userToken: token });
    seen.push(...(res.data.installations ?? []));
    url = res.next;
  }
  const known = await deps.db
    .select({ id: githubInstallations.id })
    .from(githubInstallations)
    .where(and(isNull(githubInstallations.deletedAt), isNull(githubInstallations.suspendedAt)));
  const ids = new Set(known.map((k) => k.id));
  // Org-owned only (decision 006).
  return seen.filter((i) => ids.has(i.id) && i.account.type !== "User");
}

/** Repos of one installation that the user can see. Stops early once `want` are all found. */
async function userRepos(deps: GitHubServiceDeps, token: string, installationId: number, want?: Set<string>) {
  const repos: RepoJson[] = [];
  let url: string | null = `/user/installations/${installationId}/repositories?per_page=100`;
  let truncated = false;
  for (let page = 0; url; page++) {
    if (page >= MAX_REPO_PAGES) {
      truncated = true;
      break;
    }
    const res: { data: { repositories?: RepoJson[] }; next: string | null } = await deps.client.pageOf(url, { userToken: token });
    repos.push(...(res.data.repositories ?? []));
    url = res.next;
    if (want && [...want].every((id) => repos.some((r) => r.node_id === id))) break;
  }
  return { repos, truncated };
}

export interface LinkCandidates {
  installations: {
    id: number;
    login: string;
    repos: { nodeId: string; fullName: string; private: boolean }[];
    reposTruncated: boolean;
    projects: { nodeId: string; number: number; title: string; closed: boolean }[];
  }[];
}

/** What the Admin may pick from: only what their own GitHub account can see. */
export async function listLinkCandidates(deps: GitHubServiceDeps, access: WorkspaceAccess): Promise<LinkCandidates> {
  requireCapability(access, "workspace.github_settings");
  const token = await requireUserToken(deps, access.userId);
  const installations = await userInstallations(deps, token);
  const out: LinkCandidates["installations"] = [];
  for (const inst of installations.slice(0, 10)) {
    const { repos, truncated } = await userRepos(deps, token, inst.id);
    const data = await deps.client.graphql<{ organization: { projectsV2: { nodes: ({ id: string; number: number; title: string; closed: boolean } | null)[] } } | null }>(
      { userToken: token },
      ORG_PROJECTS,
      { login: inst.account.login },
      { allowNotFound: true },
    );
    out.push({
      id: inst.id,
      login: inst.account.login,
      repos: repos.filter((r) => !r.archived).map((r) => ({ nodeId: r.node_id, fullName: r.full_name, private: r.private })),
      reposTruncated: truncated,
      projects: (data.organization?.projectsV2.nodes ?? []).flatMap((p) => (p ? [{ nodeId: p.id, number: p.number, title: p.title, closed: p.closed }] : [])),
    });
  }
  return { installations: out };
}

export interface LinkInput {
  installationId: number;
  projectNodeId: string;
  repoNodeIds: string[];
}

/** Sync targets no workspace uses any more. One statement each, for a batch. */
function pruneSyncTargets(db: Db) {
  return [
    db
      .delete(ghSyncTargets)
      .where(and(eq(ghSyncTargets.kind, "repo"), sql`${ghSyncTargets.nodeId} NOT IN (SELECT ${workspaceRepos.repoNodeId} FROM ${workspaceRepos})`)),
    db
      .delete(ghSyncTargets)
      .where(
        and(eq(ghSyncTargets.kind, "project"), sql`${ghSyncTargets.nodeId} NOT IN (SELECT ${workspaceGithub.projectNodeId} FROM ${workspaceGithub})`),
      ),
  ] as const;
}

export async function linkWorkspace(deps: GitHubServiceDeps, access: WorkspaceAccess, input: LinkInput, now = new Date()) {
  requireCapability(access, "workspace.github_settings");
  const { db } = deps;
  const repoIds = [...new Set(input.repoNodeIds)];
  if (repoIds.length === 0) throw badRequest("Pick at least one repo.");
  if (repoIds.length > MAX_LINKED_REPOS) throw badRequest(`Pick at most ${MAX_LINKED_REPOS} repos.`);
  const token = await requireUserToken(deps, access.userId);

  // 1. The installation: known to us, active, and visible to the user's own account.
  const installation = (await userInstallations(deps, token)).find((i) => i.id === input.installationId);
  if (!installation) throw forbidden("github_no_access", "Your GitHub account cannot see that installation.");

  // 2. Every repo: in that installation AND visible to the user.
  const { repos } = await userRepos(deps, token, installation.id, new Set(repoIds));
  const picked = repoIds.map((id) => repos.find((r) => r.node_id === id));
  if (picked.some((r) => !r)) throw forbidden("github_no_access", "Your GitHub account cannot see one of those repos.");

  // 3. The board: readable with the user's token and owned by the installation's org.
  const { node: project } = await deps.client.graphql<{
    node: { id: string; number: number; title: string; closed: boolean; url: string; owner: { login: string } } | null;
  }>({ userToken: token }, LINK_PROJECT, { id: input.projectNodeId }, { allowNotFound: true });
  if (!project?.id || project.owner?.login?.toLowerCase() !== installation.account.login.toLowerCase()) {
    throw forbidden("github_no_access", "Your GitHub account cannot see that board in this organization.");
  }

  const [previous] = await db.select().from(workspaceGithub).where(eq(workspaceGithub.workspaceId, access.workspace.id));
  const boardChanged = previous?.projectNodeId !== project.id;
  const workspaceId = access.workspace.id;
  await db.batch([
    db
      .insert(workspaceGithub)
      .values({ workspaceId, installationId: installation.id, projectNodeId: project.id, linkedBy: access.userId, linkedAt: now })
      .onConflictDoUpdate({
        target: workspaceGithub.workspaceId,
        set: {
          installationId: installation.id,
          projectNodeId: project.id,
          linkedBy: access.userId,
          linkedAt: now,
          // A new board has new fields: go back to auto-detected mapping.
          ...(boardChanged ? { kanbanFieldId: null, startFieldId: null, targetFieldId: null, iterationFieldId: null } : {}),
        },
      }),
    db.delete(workspaceRepos).where(eq(workspaceRepos.workspaceId, workspaceId)),
    db.insert(workspaceRepos).values(repoIds.map((repoNodeId) => ({ workspaceId, repoNodeId }))),
    ...picked.map((r) => upsertRepo(db, installation.id, r!, now)),
    upsertProject(db, {
      nodeId: project.id,
      installationId: installation.id,
      ownerLogin: project.owner.login,
      number: project.number,
      title: project.title,
      closed: project.closed,
      url: project.url,
      syncedAt: now,
    }),
    db
      .insert(ghSyncTargets)
      .values([
        ...picked.map((r) => ({ kind: "repo" as const, nodeId: r!.node_id, installationId: installation.id, locator: r!.full_name })),
        { kind: "project" as const, nodeId: project.id, installationId: installation.id, locator: `${project.owner.login}#${project.number}` },
      ])
      .onConflictDoNothing(),
    ...pruneSyncTargets(db),
    auditInsert(db, {
      userId: access.userId,
      workspaceId,
      action: "workspace.link",
      via: "user",
      target: workspaceId,
      detail: { installationId: installation.id, projectNodeId: project.id, repoNodeIds: repoIds },
    }, now),
  ] as unknown as Parameters<Db["batch"]>[0]);

  // A first, bounded sync so the board is not empty; reconcile finishes the rest on schedule.
  const first = await reconcile({
    db,
    client: deps.client,
    holder: `link:${randomToken(8)}`,
    maxPages: FIRST_SYNC_PAGES,
    maxTargets: repoIds.length + 1,
    onlyNodeIds: [project.id, ...repoIds],
  });
  return { projectNodeId: project.id, repoNodeIds: repoIds, firstSync: first };
}

export async function unlinkWorkspace(db: Db, access: WorkspaceAccess, now = new Date()) {
  requireCapability(access, "workspace.github_settings");
  const workspaceId = access.workspace.id;
  await db.batch([
    db.delete(workspaceRepos).where(eq(workspaceRepos.workspaceId, workspaceId)),
    db.delete(workspaceGithub).where(eq(workspaceGithub.workspaceId, workspaceId)),
    ...pruneSyncTargets(db),
    auditInsert(db, { userId: access.userId, workspaceId, action: "workspace.unlink", via: "local", target: workspaceId }, now),
  ] as unknown as Parameters<Db["batch"]>[0]);
}

/** The workspace's link as stored: board, repos, fields. Cache only, no GitHub calls. */
export async function getWorkspaceLink(db: Db, workspaceId: string) {
  const [link] = await db.select().from(workspaceGithub).where(eq(workspaceGithub.workspaceId, workspaceId));
  if (!link) return null;
  const [project, repos, fields] = await Promise.all([
    db.select().from(ghProjects).where(eq(ghProjects.nodeId, link.projectNodeId)).then((r) => r[0] ?? null),
    db
      .select({ nodeId: ghRepos.nodeId, fullName: ghRepos.fullName, available: ghRepos.available, private: ghRepos.private, archived: ghRepos.archived })
      .from(workspaceRepos)
      .innerJoin(ghRepos, eq(ghRepos.nodeId, workspaceRepos.repoNodeId))
      .where(eq(workspaceRepos.workspaceId, workspaceId)),
    db.select().from(ghProjectFields).where(eq(ghProjectFields.projectNodeId, link.projectNodeId)),
  ]);
  return { link, project, repos, fields };
}
