import { CAPABILITIES, ROLES, can } from "@gitwork/core";
import { users } from "@gitwork/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireCapability, requireWorkspaceAccess } from "../services/access";
import { createAccountWithWorkspace, createWorkspace, listMyWorkspaces } from "../services/accounts";
import {
  acceptInvite,
  createInvite,
  getInvitePreview,
  inviteEmail,
  listInvites,
  revokeInvite,
} from "../services/invites";
import { changeMemberRole, listMembers, removeMember } from "../services/members";
import { getSignupPolicy, setSignupPolicy } from "../instance-settings";
import { installUrl, isInstanceAdmin, removeGitHubApp, startManifestFlow } from "../github/setup";
import { badRequest, conflict, forbidden } from "../errors";
import { getWorkspaceLink, linkWorkspace, listLinkCandidates, MAX_LINKED_REPOS, unlinkWorkspace } from "../services/link";
import { createTask, getTask, listTasks, resolveMapping, setFieldMapping, updateTask } from "../services/tasks";
import { serializedSnapshot } from "../services/board-sync";
import { updateWorkspaceSettings } from "../services/workspace-settings";
import {
  MAX_ATTACHMENTS,
  createDoc,
  deleteDoc,
  getDoc,
  heartbeat,
  leave,
  listDocs,
  rawDocFile,
  refreshDocs,
  renameDoc,
  saveDoc,
  setDocsConfig,
  workspaceDocRepos,
} from "../services/docs";
import { type RouteContext, createApiHandler, route } from "./router";
import type { GitHubClient } from "../github/client";

/** GitHub-backed services need the App; before /setup there is none. */
function githubDeps(ctx: RouteContext) {
  if (!ctx.deps.github) throw conflict("github_not_setup", "The GitHub App is not set up on this instance yet.");
  return { db: ctx.deps.database.db, client: ctx.deps.github.client, auth: ctx.deps.auth };
}

function taskDeps(ctx: RouteContext) {
  const user = ctx.session!.user;
  return { ...githubDeps(ctx), displayName: user.name?.trim() || user.email };
}

/** Calls GitHub only when it must: without the App, cached docs still open. */
const NO_GITHUB = new Proxy({} as GitHubClient, {
  get() {
    return () => {
      throw conflict("github_not_setup", "The GitHub App is not set up on this instance yet.");
    };
  },
});

function readDeps(ctx: RouteContext) {
  return { db: ctx.deps.database.db, client: ctx.deps.github?.client ?? NO_GITHUB, auth: ctx.deps.auth };
}

function docDeps(ctx: RouteContext) {
  const user = ctx.session!.user;
  return { ...githubDeps(ctx), author: { name: user.name?.trim() || user.email, email: user.email } };
}

/** `?repo=…&path=…` on doc reads, deletes, and presence. */
function fileQuery(request: Request) {
  const q = new URL(request.url).searchParams;
  const repo = q.get("repo") ?? "";
  const path = q.get("path") ?? "";
  if (!repo || !path || repo.length > 200 || path.length > 400) throw badRequest("Name a repo and a path.");
  return { repo, path, sha: q.get("sha") ?? "" };
}

function requireInstanceAdmin(ctx: RouteContext) {
  if (!isInstanceAdmin(ctx.session!.user.email, ctx.deps.instanceAdminEmails ?? [])) throw forbidden();
}

const name = z.string().trim().min(1, "Name is required.").max(100, "Name is too long.");
const role = z.enum(ROLES);
const nodeId = z.string().min(1).max(200);
const fieldInput = z.union([
  z.object({ type: z.literal("single_select"), optionId: z.string().min(1).max(200) }),
  z.object({ type: z.literal("date"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.") }),
  z.object({ type: z.literal("text"), text: z.string().max(1024) }),
  z.object({ type: z.literal("number"), number: z.number().finite() }),
  z.object({ type: z.literal("iteration"), iterationId: z.string().min(1).max(200) }),
]);
const fieldChanges = z.record(nodeId, fieldInput.nullable()).optional();
const taskTitle = z.string().trim().min(1, "Title is required.").max(256, "Title is too long.");
// GitHub's issue body limit.
const taskBody = z.string().max(65_536, "The description is too long.");
const docPath = z.string().min(1, "Name the doc.").max(400, "That path is too long.");
const blobSha = z.string().regex(/^[0-9a-f]{40}$/, "Unknown version of the doc.");
// The service checks the UTF-8 size (1 MB); this only stops absurd bodies early.
const docText = z.string().max(1_000_000, "This doc is too large to save here.");
const attachment = z.object({ path: docPath, data: z.string().max(14_000_000, "Images can be at most 10 MB.") });

export const routes = [
  route({
    method: "GET",
    pattern: "/me",
    async handler({ deps, session }) {
      const user = session!.user;
      return {
        user: { id: user.id, email: user.email, name: user.name },
        workspaces: await listMyWorkspaces(deps.database.db, user.id),
      };
    },
  }),

  route({
    method: "POST",
    pattern: "/accounts",
    body: z.object({ accountName: name, workspaceName: name }),
    async handler({ deps, session, body }) {
      return createAccountWithWorkspace(deps.database.db, {
        userId: session!.user.id,
        ...body,
        isInstanceAdmin: isInstanceAdmin(session!.user.email, deps.instanceAdminEmails ?? []),
      });
    },
  }),

  route({
    method: "POST",
    pattern: "/accounts/:accountId/workspaces",
    body: z.object({ name }),
    async handler({ deps, session, params, body }) {
      return createWorkspace(deps.database.db, { userId: session!.user.id, accountId: params.accountId!, name: body.name });
    },
  }),

  route({
    method: "GET",
    pattern: "/workspaces/:workspaceId",
    async handler({ deps, session, params }) {
      const access = await requireWorkspaceAccess(deps.database.db, session!.user.id, params.workspaceId!);
      const capabilities = CAPABILITIES.filter((c) => can(access.actor, c, access.settings));
      return {
        workspace: access.workspace,
        settings: access.settings,
        role: access.role,
        hasGitHub: access.actor.hasGitHub,
        capabilities,
        githubInstallUrl: deps.github && capabilities.includes("github.install_app") ? installUrl(deps.github.app) : null,
      };
    },
  }),

  route({
    method: "GET",
    pattern: "/workspaces/:workspaceId/tasks",
    async handler({ deps, session, params }) {
      const access = await requireWorkspaceAccess(deps.database.db, session!.user.id, params.workspaceId!);
      return listTasks(deps.database.db, access);
    },
  }),

  // The client store polls this (decision 033). 304 when nothing this viewer can see changed.
  route({
    method: "GET",
    pattern: "/workspaces/:workspaceId/sync",
    async handler({ deps, session, params, request }) {
      const access = await requireWorkspaceAccess(deps.database.db, session!.user.id, params.workspaceId!);
      const { body, etag } = await serializedSnapshot(deps.database.db, access);
      // Per-user data: no shared cache (a proxy or CDN) may store or reuse it.
      const headers = { etag, "cache-control": "private, no-cache", vary: "Cookie" };
      if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
      return new Response(body, { status: 200, headers: { ...headers, "content-type": "application/json" } });
    },
  }),

  route({
    method: "GET",
    pattern: "/workspaces/:workspaceId/tasks/:itemId",
    async handler({ deps, session, params }) {
      const access = await requireWorkspaceAccess(deps.database.db, session!.user.id, params.workspaceId!);
      return { task: await getTask(deps.database.db, access, params.itemId!) };
    },
  }),

  route({
    method: "POST",
    pattern: "/workspaces/:workspaceId/tasks",
    body: z.object({ repoNodeId: nodeId, title: taskTitle, body: taskBody.optional(), fields: fieldChanges }),
    async handler(ctx) {
      const access = await requireWorkspaceAccess(ctx.deps.database.db, ctx.session!.user.id, ctx.params.workspaceId!);
      requireCapability(access, "tasks.write"); // before "GitHub not set up": no hints for Read Only
      return { task: await createTask(taskDeps(ctx), access, ctx.body) };
    },
  }),

  route({
    method: "PATCH",
    pattern: "/workspaces/:workspaceId/tasks/:itemId",
    body: z.object({
      title: taskTitle.optional(),
      body: taskBody.optional(),
      state: z.enum(["open", "closed"]).optional(),
      stateReason: z.enum(["completed", "not_planned", "reopened"]).nullable().optional(),
      fields: fieldChanges,
    }),
    async handler(ctx) {
      const access = await requireWorkspaceAccess(ctx.deps.database.db, ctx.session!.user.id, ctx.params.workspaceId!);
      requireCapability(access, "tasks.write");
      return { task: await updateTask(taskDeps(ctx), access, ctx.params.itemId!, ctx.body) };
    },
  }),

  route({
    method: "GET",
    pattern: "/workspaces/:workspaceId/docs",
    async handler({ deps, session, params }) {
      const access = await requireWorkspaceAccess(deps.database.db, session!.user.id, params.workspaceId!);
      return listDocs(deps.database.db, access);
    },
  }),

  route({
    method: "POST",
    pattern: "/workspaces/:workspaceId/docs/refresh",
    async handler(ctx) {
      const access = await requireWorkspaceAccess(ctx.deps.database.db, ctx.session!.user.id, ctx.params.workspaceId!);
      const out = await refreshDocs(githubDeps(ctx), access);
      return { synced: out.synced.length, failed: out.failed.length };
    },
  }),

  route({
    method: "GET",
    pattern: "/workspaces/:workspaceId/docs/file",
    async handler(ctx) {
      const access = await requireWorkspaceAccess(ctx.deps.database.db, ctx.session!.user.id, ctx.params.workspaceId!);
      const q = fileQuery(ctx.request);
      return { doc: await getDoc(readDeps(ctx), access, q.repo, q.path) };
    },
  }),

  route({
    method: "GET",
    pattern: "/workspaces/:workspaceId/docs/raw",
    async handler(ctx) {
      const access = await requireWorkspaceAccess(ctx.deps.database.db, ctx.session!.user.id, ctx.params.workspaceId!);
      const q = fileQuery(ctx.request);
      return rawDocFile(githubDeps(ctx), access, q.repo, q.path);
    },
  }),

  route({
    method: "PUT",
    pattern: "/workspaces/:workspaceId/docs/file",
    body: z.object({
      repoNodeId: nodeId,
      path: docPath,
      baseSha: blobSha,
      text: docText,
      attachments: z.array(attachment).max(MAX_ATTACHMENTS).optional(),
      message: z.string().max(200).optional(),
    }),
    async handler(ctx) {
      const access = await requireWorkspaceAccess(ctx.deps.database.db, ctx.session!.user.id, ctx.params.workspaceId!);
      requireCapability(access, "docs.write");
      return saveDoc(docDeps(ctx), access, ctx.body);
    },
  }),

  route({
    method: "POST",
    pattern: "/workspaces/:workspaceId/docs/file",
    body: z.object({ repoNodeId: nodeId, path: docPath, text: docText.optional() }),
    async handler(ctx) {
      const access = await requireWorkspaceAccess(ctx.deps.database.db, ctx.session!.user.id, ctx.params.workspaceId!);
      requireCapability(access, "docs.write");
      return createDoc(docDeps(ctx), access, ctx.body);
    },
  }),

  route({
    method: "POST",
    pattern: "/workspaces/:workspaceId/docs/rename",
    body: z.object({ repoNodeId: nodeId, path: docPath, baseSha: blobSha, newPath: docPath }),
    async handler(ctx) {
      const access = await requireWorkspaceAccess(ctx.deps.database.db, ctx.session!.user.id, ctx.params.workspaceId!);
      requireCapability(access, "docs.write");
      return renameDoc(docDeps(ctx), access, ctx.body);
    },
  }),

  route({
    method: "DELETE",
    pattern: "/workspaces/:workspaceId/docs/file",
    async handler(ctx) {
      const access = await requireWorkspaceAccess(ctx.deps.database.db, ctx.session!.user.id, ctx.params.workspaceId!);
      requireCapability(access, "docs.delete");
      const q = fileQuery(ctx.request);
      if (!/^[0-9a-f]{40}$/.test(q.sha)) throw badRequest("Unknown version of the doc.");
      return deleteDoc(docDeps(ctx), access, { repoNodeId: q.repo, path: q.path, baseSha: q.sha });
    },
  }),

  route({
    method: "POST",
    pattern: "/workspaces/:workspaceId/docs/presence",
    body: z.object({ repoNodeId: nodeId, path: docPath }),
    async handler({ deps, session, params, body }) {
      const access = await requireWorkspaceAccess(deps.database.db, session!.user.id, params.workspaceId!);
      return { editors: await heartbeat(deps.database.db, access, body.repoNodeId, body.path) };
    },
  }),

  route({
    method: "DELETE",
    pattern: "/workspaces/:workspaceId/docs/presence",
    async handler({ deps, session, params, request }) {
      const access = await requireWorkspaceAccess(deps.database.db, session!.user.id, params.workspaceId!);
      const q = fileQuery(request);
      await leave(deps.database.db, access, q.repo, q.path);
    },
  }),

  route({
    method: "PATCH",
    pattern: "/workspaces/:workspaceId/github/repos/:repoNodeId/docs",
    body: z.object({ docsPath: z.string().max(200).optional(), docsBranch: z.string().max(200).nullable().optional() }),
    async handler(ctx) {
      const access = await requireWorkspaceAccess(ctx.deps.database.db, ctx.session!.user.id, ctx.params.workspaceId!);
      requireCapability(access, "workspace.github_settings");
      await setDocsConfig(githubDeps(ctx), access, { repoNodeId: ctx.params.repoNodeId!, ...ctx.body });
    },
  }),

  route({
    method: "GET",
    pattern: "/workspaces/:workspaceId/github",
    async handler({ deps, session, params }) {
      const { db } = deps.database;
      await requireWorkspaceAccess(db, session!.user.id, params.workspaceId!);
      const data = await getWorkspaceLink(db, params.workspaceId!);
      if (!data) return { linked: false };
      const fields = data.fields.map((f) => ({ id: f.nodeId, name: f.name, dataType: f.dataType }));
      const docRepos = await workspaceDocRepos(db, params.workspaceId!);
      return {
        linked: true,
        installationId: data.link.installationId,
        board: data.project ? { nodeId: data.project.nodeId, title: data.project.title, url: data.project.url, available: data.project.available } : null,
        repos: data.repos.map((r) => {
          const d = docRepos.find((x) => x.repoNodeId === r.nodeId);
          return {
            nodeId: r.nodeId,
            fullName: r.fullName,
            available: r.available,
            docs: d ? { path: d.path, branch: d.branch, defaultBranch: d.defaultBranch } : null,
          };
        }),
        fields,
        mapping: resolveMapping(fields, data.link),
      };
    },
  }),

  route({
    method: "GET",
    pattern: "/workspaces/:workspaceId/github/candidates",
    async handler(ctx) {
      const access = await requireWorkspaceAccess(ctx.deps.database.db, ctx.session!.user.id, ctx.params.workspaceId!);
      requireCapability(access, "workspace.github_settings");
      return listLinkCandidates(githubDeps(ctx), access);
    },
  }),

  route({
    method: "PUT",
    pattern: "/workspaces/:workspaceId/github",
    body: z.object({
      installationId: z.number().int().positive(),
      projectNodeId: nodeId,
      repoNodeIds: z.array(nodeId).min(1, "Pick at least one repo.").max(MAX_LINKED_REPOS),
    }),
    async handler(ctx) {
      const access = await requireWorkspaceAccess(ctx.deps.database.db, ctx.session!.user.id, ctx.params.workspaceId!);
      requireCapability(access, "workspace.github_settings");
      const out = await linkWorkspace(githubDeps(ctx), access, ctx.body);
      return { projectNodeId: out.projectNodeId, repoNodeIds: out.repoNodeIds, firstSync: { synced: out.firstSync.synced.length, skipped: out.firstSync.skipped ?? null } };
    },
  }),

  route({
    method: "DELETE",
    pattern: "/workspaces/:workspaceId/github",
    async handler({ deps, session, params }) {
      const access = await requireWorkspaceAccess(deps.database.db, session!.user.id, params.workspaceId!);
      await unlinkWorkspace(deps.database.db, access);
    },
  }),

  route({
    method: "PATCH",
    pattern: "/workspaces/:workspaceId/github/fields",
    body: z.object({
      kanbanFieldId: nodeId.nullable().optional(),
      startFieldId: nodeId.nullable().optional(),
      targetFieldId: nodeId.nullable().optional(),
      iterationFieldId: nodeId.nullable().optional(),
    }),
    async handler({ deps, session, params, body }) {
      const access = await requireWorkspaceAccess(deps.database.db, session!.user.id, params.workspaceId!);
      return { mapping: await setFieldMapping(deps.database.db, access, body) };
    },
  }),

  route({
    method: "PATCH",
    pattern: "/workspaces/:workspaceId/settings",
    body: z.object({
      hideLabel: z.string().max(50).nullable().optional(),
      hideFolder: z.string().max(200).nullable().optional(),
      reviewBotDocEdits: z.boolean().optional(),
      showDraftsToReadOnly: z.boolean().optional(),
      readOnlyCanComment: z.boolean().optional(),
    }),
    async handler({ deps, session, params, body }) {
      const access = await requireWorkspaceAccess(deps.database.db, session!.user.id, params.workspaceId!);
      await updateWorkspaceSettings(deps.database.db, access, body);
    },
  }),

  route({
    method: "GET",
    pattern: "/workspaces/:workspaceId/members",
    async handler({ deps, session, params }) {
      const access = await requireWorkspaceAccess(deps.database.db, session!.user.id, params.workspaceId!);
      return { members: await listMembers(deps.database.db, access) };
    },
  }),

  route({
    method: "PATCH",
    pattern: "/workspaces/:workspaceId/members/:userId",
    body: z.object({ role }),
    async handler({ deps, session, params, body }) {
      const access = await requireWorkspaceAccess(deps.database.db, session!.user.id, params.workspaceId!);
      await changeMemberRole(deps.database.db, access, { userId: params.userId!, role: body.role });
    },
  }),

  route({
    method: "DELETE",
    pattern: "/workspaces/:workspaceId/members/:userId",
    async handler({ deps, session, params }) {
      const access = await requireWorkspaceAccess(deps.database.db, session!.user.id, params.workspaceId!);
      await removeMember(deps.database.db, access, params.userId!);
    },
  }),

  route({
    method: "GET",
    pattern: "/workspaces/:workspaceId/invites",
    async handler({ deps, session, params }) {
      const access = await requireWorkspaceAccess(deps.database.db, session!.user.id, params.workspaceId!);
      return { invites: await listInvites(deps.database.db, access) };
    },
  }),

  route({
    method: "POST",
    pattern: "/workspaces/:workspaceId/invites",
    body: z.object({ email: z.string().min(1, "Email is required."), role }),
    async handler({ deps, session, params, body }) {
      const { db } = deps.database;
      const access = await requireWorkspaceAccess(db, session!.user.id, params.workspaceId!);
      const invite = await createInvite(db, access, body);
      const [inviter] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, access.userId));
      await deps.email.send(
        inviteEmail({
          baseURL: deps.baseURL,
          to: invite.email,
          token: invite.token,
          workspaceName: access.workspace.name,
          inviterName: inviter?.name || inviter?.email || "Someone",
        }),
      );
      return { id: invite.inviteId, email: invite.email, expiresAt: invite.expiresAt };
    },
  }),

  route({
    method: "DELETE",
    pattern: "/workspaces/:workspaceId/invites/:inviteId",
    async handler({ deps, session, params }) {
      const access = await requireWorkspaceAccess(deps.database.db, session!.user.id, params.workspaceId!);
      await revokeInvite(deps.database.db, access, params.inviteId!);
    },
  }),

  route({
    method: "GET",
    pattern: "/invites/:token",
    auth: false,
    async handler({ deps, params }) {
      return getInvitePreview(deps.database.db, params.token!);
    },
  }),

  route({
    method: "POST",
    pattern: "/invites/:token/accept",
    async handler({ deps, session, params }) {
      return acceptInvite(deps.database.db, {
        token: params.token!,
        userId: session!.user.id,
        userEmail: session!.user.email,
      });
    },
  }),
];

routes.push(
  route({
    method: "GET",
    pattern: "/setup",
    async handler(ctx) {
      requireInstanceAdmin(ctx);
      const app = ctx.deps.github?.app;
      return {
        github: app
          ? { configured: true, slug: app.slug, htmlUrl: app.htmlUrl, source: app.source }
          : { configured: false, error: ctx.deps.githubError ?? null },
        signups: await getSignupPolicy(ctx.deps.database.db),
      };
    },
  }),
  route({
    method: "POST",
    pattern: "/setup/github/manifest",
    body: z.object({ org: z.string().trim().max(39).optional(), name: z.string().trim().max(34).optional() }),
    async handler(ctx) {
      requireInstanceAdmin(ctx);
      return startManifestFlow(ctx.deps.database.db, { userId: ctx.session!.user.id, baseURL: ctx.deps.baseURL, ...ctx.body });
    },
  }),
  route({
    method: "DELETE",
    pattern: "/setup/github",
    async handler(ctx) {
      requireInstanceAdmin(ctx);
      if (ctx.deps.github?.app.source === "env") throw forbidden("env_app", "This App comes from environment variables.");
      await removeGitHubApp(ctx.deps.database.db);
    },
  }),
  route({
    method: "PUT",
    pattern: "/setup/signups",
    body: z.object({ policy: z.enum(["open", "invite-only"]) }),
    async handler(ctx) {
      requireInstanceAdmin(ctx);
      await setSignupPolicy(ctx.deps.database.db, ctx.body.policy);
    },
  }),
);

export const handleApiRequest = createApiHandler(routes);
