import {
  type Actor,
  type Capability,
  type PermissionSettings,
  type Role,
  authorize,
  effectiveRole,
} from "@gitwork/core";
import { type Db, accountOwners, authIdentities, workspaceMembers, workspaces } from "@gitwork/db";
import { and, eq } from "drizzle-orm";
import { forbidden, notFound } from "../errors";

export interface WorkspaceAccess {
  userId: string;
  workspace: { id: string; accountId: string; name: string; hideLabel: string | null };
  role: Role;
  isAccountOwner: boolean;
  actor: Actor;
  settings: PermissionSettings;
}

export async function hasLinkedGitHub(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: authIdentities.id })
    .from(authIdentities)
    .where(and(eq(authIdentities.userId, userId), eq(authIdentities.providerId, "github")))
    .limit(1);
  return row !== undefined;
}

/** The user's access to one workspace, or null when they have none. */
export async function getWorkspaceAccess(db: Db, userId: string, workspaceId: string): Promise<WorkspaceAccess | null> {
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) return null;
  const [[member], [owner], hasGitHub] = await Promise.all([
    db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1),
    db
      .select({ userId: accountOwners.userId })
      .from(accountOwners)
      .where(and(eq(accountOwners.accountId, workspace.accountId), eq(accountOwners.userId, userId)))
      .limit(1),
    hasLinkedGitHub(db, userId),
  ]);
  const role = effectiveRole({ memberRole: member?.role ?? null, isAccountOwner: owner !== undefined });
  if (!role) return null;
  return {
    userId,
    workspace: { id: workspace.id, accountId: workspace.accountId, name: workspace.name, hideLabel: workspace.hideLabel },
    role,
    isAccountOwner: owner !== undefined,
    actor: { role, hasGitHub },
    settings: {
      readOnlyCanComment: workspace.readOnlyCanComment,
      showDraftsToReadOnly: workspace.showDraftsToReadOnly,
    },
  };
}

/** Loads access or throws 404. No access and no workspace look the same to the caller. */
export async function requireWorkspaceAccess(db: Db, userId: string, workspaceId: string): Promise<WorkspaceAccess> {
  const access = await getWorkspaceAccess(db, userId, workspaceId);
  if (!access) throw notFound("Workspace not found.");
  return access;
}

export function requireCapability(access: WorkspaceAccess, capability: Capability): void {
  const decision = authorize(access.actor, capability, access.settings);
  if (decision.ok) return;
  if (decision.reason === "github_link_required") {
    throw forbidden("github_link_required", "Link your GitHub account to do this.");
  }
  throw forbidden();
}
