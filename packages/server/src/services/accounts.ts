import type { Role } from "@gitwork/core";
import { type Db, accountOwners, accounts, workspaceMembers, workspaces } from "@gitwork/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { newId } from "../crypto";
import { badRequest, forbidden } from "../errors";
import { getSignupPolicy } from "../instance-settings";

function cleanName(value: string, what: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 100) throw badRequest(`${what} must be 1–100 characters.`);
  return name;
}

/**
 * Who may create an Account (decision 017). Open instances: anyone signed in. Invite-only
 * instances: the first Account on the instance, or someone who already owns an Account.
 */
async function mayCreateAccount(db: Db, userId: string): Promise<boolean> {
  if ((await getSignupPolicy(db)) === "open") return true;
  const [anyAccount] = await db.select({ id: accounts.id }).from(accounts).limit(1);
  if (!anyAccount) return true;
  const [owned] = await db.select().from(accountOwners).where(eq(accountOwners.userId, userId)).limit(1);
  return owned !== undefined;
}

/** Creates an Account, makes the user its Owner, and creates its first workspace — atomically. */
export async function createAccountWithWorkspace(
  db: Db,
  input: { userId: string; accountName: string; workspaceName: string },
): Promise<{ accountId: string; workspaceId: string }> {
  const accountName = cleanName(input.accountName, "Account name");
  const workspaceName = cleanName(input.workspaceName, "Workspace name");
  if (!(await mayCreateAccount(db, input.userId))) {
    throw forbidden("account_creation_closed", "New accounts are invite-only on this instance.");
  }
  const accountId = newId();
  const workspaceId = newId();
  await db.batch([
    db.insert(accounts).values({ id: accountId, name: accountName }),
    db.insert(accountOwners).values({ accountId, userId: input.userId }),
    db.insert(workspaces).values({ id: workspaceId, accountId, name: workspaceName }),
  ]);
  return { accountId, workspaceId };
}

/** Only Account Owners add workspaces to an Account. */
export async function createWorkspace(
  db: Db,
  input: { userId: string; accountId: string; name: string },
): Promise<{ workspaceId: string }> {
  const name = cleanName(input.name, "Workspace name");
  const owned = await db.select().from(accountOwners).where(eq(accountOwners.userId, input.userId));
  if (!owned.some((o) => o.accountId === input.accountId)) throw forbidden();
  const workspaceId = newId();
  await db.insert(workspaces).values({ id: workspaceId, accountId: input.accountId, name });
  return { workspaceId };
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  role: Role;
}

/**
 * Every workspace the user can open, with their effective role. Subqueries, not IN-lists: D1
 * allows at most 100 bound parameters per query, and an agency user can be in more workspaces.
 */
export async function listMyWorkspaces(db: Db, userId: string): Promise<WorkspaceSummary[]> {
  const ownedAccountIds = db.select({ id: accountOwners.accountId }).from(accountOwners).where(eq(accountOwners.userId, userId));
  const memberWorkspaceIds = db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      accountId: workspaces.accountId,
      accountName: accounts.name,
      memberRole: workspaceMembers.role,
      isOwner: sql<number>`${workspaces.accountId} IN ${ownedAccountIds}`,
    })
    .from(workspaces)
    .innerJoin(accounts, eq(accounts.id, workspaces.accountId))
    .leftJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)))
    .where(or(inArray(workspaces.accountId, ownedAccountIds), inArray(workspaces.id, memberWorkspaceIds)));
  return rows
    .map(({ memberRole, isOwner, ...w }) => ({ ...w, role: (isOwner ? "owner" : memberRole) as Role }))
    .sort((a, b) => a.accountName.localeCompare(b.accountName) || a.name.localeCompare(b.name));
}
