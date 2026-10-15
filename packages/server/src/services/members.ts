import { type Role, canManageMember } from "@gitwork/core";
import { type Db, accountOwners, users, workspaceMembers } from "@gitwork/db";
import { and, eq } from "drizzle-orm";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { type WorkspaceAccess, requireCapability } from "./access";

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: Role;
  /** Owner through the Account; not changeable per workspace. */
  viaAccount: boolean;
}

/** Everyone with access: explicit members plus the Account's Owners. */
export async function listMembers(db: Db, access: WorkspaceAccess): Promise<MemberView[]> {
  requireCapability(access, "workspace.view");
  const [members, owners] = await Promise.all([
    db
      .select({ userId: users.id, name: users.name, email: users.email, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, access.workspace.id)),
    db
      .select({ userId: users.id, name: users.name, email: users.email })
      .from(accountOwners)
      .innerJoin(users, eq(users.id, accountOwners.userId))
      .where(eq(accountOwners.accountId, access.workspace.accountId)),
  ]);
  const byUser = new Map<string, MemberView>();
  for (const m of members) byUser.set(m.userId, { ...m, viaAccount: false });
  for (const o of owners) byUser.set(o.userId, { ...o, role: "owner", viaAccount: true });
  return [...byUser.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

async function currentMemberRole(db: Db, workspaceId: string, userId: string): Promise<Role | null> {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

async function isAccountOwner(db: Db, accountId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(accountOwners)
    .where(and(eq(accountOwners.accountId, accountId), eq(accountOwners.userId, userId)))
    .limit(1);
  return row !== undefined;
}

/**
 * Changes a member's role. The UPDATE only applies if the role is still the one we checked, so a
 * concurrent change cannot slip a promotion past the permission check.
 */
export async function changeMemberRole(
  db: Db,
  access: WorkspaceAccess,
  input: { userId: string; role: Role },
): Promise<void> {
  if (await isAccountOwner(db, access.workspace.accountId, input.userId)) {
    throw conflict("account_owner", "Account Owners are Owner in every workspace. Change it at the Account.");
  }
  const current = await currentMemberRole(db, access.workspace.id, input.userId);
  if (!current) throw notFound("Member not found.");
  if (input.userId === access.userId) throw badRequest("You cannot change your own role.");
  if (!canManageMember(access.actor, current, input.role)) throw forbidden();
  const result = await db
    .update(workspaceMembers)
    .set({ role: input.role })
    .where(
      and(
        eq(workspaceMembers.workspaceId, access.workspace.id),
        eq(workspaceMembers.userId, input.userId),
        eq(workspaceMembers.role, current),
      ),
    )
    .returning({ userId: workspaceMembers.userId });
  if (result.length === 0) throw conflict("changed", "This member changed. Reload and try again.");
}

/** Removes a member. Anyone may remove themselves (leave). Same guarded write as role changes. */
export async function removeMember(db: Db, access: WorkspaceAccess, userId: string): Promise<void> {
  if (await isAccountOwner(db, access.workspace.accountId, userId)) {
    throw conflict("account_owner", "Account Owners cannot be removed from a workspace.");
  }
  const current = await currentMemberRole(db, access.workspace.id, userId);
  if (!current) throw notFound("Member not found.");
  const leaving = userId === access.userId;
  if (!leaving && !canManageMember(access.actor, current, null)) throw forbidden();
  const result = await db
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, access.workspace.id),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.role, current),
      ),
    )
    .returning({ userId: workspaceMembers.userId });
  if (result.length === 0) throw conflict("changed", "This member changed. Reload and try again.");
}
