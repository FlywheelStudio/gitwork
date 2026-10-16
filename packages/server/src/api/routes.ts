import { CAPABILITIES, ROLES, can } from "@gitwork/core";
import { users } from "@gitwork/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireWorkspaceAccess } from "../services/access";
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
import { forbidden } from "../errors";
import { type RouteContext, createApiHandler, route } from "./router";

function requireInstanceAdmin(ctx: RouteContext) {
  if (!isInstanceAdmin(ctx.session!.user.email, ctx.deps.instanceAdminEmails ?? [])) throw forbidden();
}

const name = z.string().trim().min(1, "Name is required.").max(100, "Name is too long.");
const role = z.enum(ROLES);

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
        role: access.role,
        hasGitHub: access.actor.hasGitHub,
        capabilities,
        githubInstallUrl: deps.github && capabilities.includes("github.install_app") ? installUrl(deps.github.app) : null,
      };
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
