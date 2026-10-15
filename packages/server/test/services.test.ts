import { type Database, authIdentities, invites, users, workspaceMembers } from "@gitwork/db";
import { type TestDriver, allTestDrivers } from "@gitwork/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../src/errors";
import { setSignupPolicy } from "../src/instance-settings";
import { getWorkspaceAccess, requireWorkspaceAccess } from "../src/services/access";
import { createAccountWithWorkspace, createWorkspace, listMyWorkspaces } from "../src/services/accounts";
import {
  INVITE_TTL_MS,
  acceptInvite,
  createInvite,
  getInvitePreview,
  listInvites,
  revokeInvite,
} from "../src/services/invites";
import { changeMemberRole, listMembers, removeMember } from "../src/services/members";

const drivers = await allTestDrivers();
afterAll(() => Promise.all(drivers.map((d) => d.dispose())));

async function rejects(promise: Promise<unknown>, status: number, code?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ServiceError);
  expect((error as ServiceError).status).toBe(status);
  if (code) expect((error as ServiceError).code).toBe(code);
}

describe.each(drivers)("services on $name", (driver: TestDriver) => {
  let database: Database;
  let db: Database["db"];
  let ws: { accountId: string; workspaceId: string };

  async function addUser(id: string, email = `${id}@example.com`) {
    await db.insert(users).values({ id, name: id, email });
  }
  async function addMember(userId: string, role: "owner" | "admin" | "member" | "read_only") {
    await addUser(userId);
    await db.insert(workspaceMembers).values({ workspaceId: ws.workspaceId, userId, role });
  }
  const access = (userId: string) => requireWorkspaceAccess(db, userId, ws.workspaceId);
  const membership = async (userId: string) =>
    (
      await db
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, ws.workspaceId), eq(workspaceMembers.userId, userId)))
    )[0];

  beforeEach(async () => {
    database = await driver.fresh();
    db = database.db;
    await addUser("owner");
    ws = await createAccountWithWorkspace(db, { userId: "owner", accountName: "Acme", workspaceName: "Website" });
  });

  describe("accounts and access", () => {
    it("makes the creator Owner through the Account", async () => {
      const a = await access("owner");
      expect(a.role).toBe("owner");
      expect(a.isAccountOwner).toBe(true);
    });

    it("gives no access to a stranger", async () => {
      await addUser("stranger");
      expect(await getWorkspaceAccess(db, "stranger", ws.workspaceId)).toBeNull();
      await rejects(access("stranger"), 404);
    });

    it("lists owned and member workspaces with roles, and nothing else", async () => {
      await addUser("other");
      const otherWs = await createAccountWithWorkspace(db, { userId: "other", accountName: "Zed", workspaceName: "App" });
      await db.insert(workspaceMembers).values({ workspaceId: otherWs.workspaceId, userId: "owner", role: "read_only" });
      await createAccountWithWorkspace(db, { userId: "other", accountName: "Hidden", workspaceName: "Secret" });
      const list = await listMyWorkspaces(db, "owner");
      expect(list.map((w) => [w.accountName, w.name, w.role])).toEqual([
        ["Acme", "Website", "owner"],
        ["Zed", "App", "read_only"],
      ]);
    });

    it("lets only Account Owners add workspaces", async () => {
      await addMember("admin", "admin");
      await rejects(createWorkspace(db, { userId: "admin", accountId: ws.accountId, name: "New" }), 403);
      const { workspaceId } = await createWorkspace(db, { userId: "owner", accountId: ws.accountId, name: "New" });
      expect((await getWorkspaceAccess(db, "owner", workspaceId))?.role).toBe("owner");
    });

    it("reports a linked GitHub account", async () => {
      expect((await access("owner")).actor.hasGitHub).toBe(false);
      await db.insert(authIdentities).values({ id: "g1", accountId: "12345", providerId: "github", userId: "owner" });
      expect((await access("owner")).actor.hasGitHub).toBe(true);
    });

    it("lets only existing Account Owners create Accounts on an invite-only instance", async () => {
      await setSignupPolicy(db, "invite-only");
      await addUser("newcomer");
      await rejects(
        createAccountWithWorkspace(db, { userId: "newcomer", accountName: "N", workspaceName: "W" }),
        403,
        "account_creation_closed",
      );
      await createAccountWithWorkspace(db, { userId: "owner", accountName: "Second", workspaceName: "W" });
    });
  });

  describe("invites", () => {
    it("lets an Admin invite up to Member, not Admin", async () => {
      await addMember("admin", "admin");
      const a = await access("admin");
      await rejects(createInvite(db, a, { email: "x@example.com", role: "admin" }), 403, "role_too_high");
      const invite = await createInvite(db, a, { email: " New@Example.com ", role: "member" });
      expect(invite.email).toBe("new@example.com");
    });

    it("stops Members and Read Only users from inviting", async () => {
      await addMember("member", "member");
      await addMember("client", "read_only");
      await rejects(createInvite(db, await access("member"), { email: "x@example.com", role: "read_only" }), 403);
      await rejects(createInvite(db, await access("client"), { email: "x@example.com", role: "read_only" }), 403);
    });

    it("stores only the token hash", async () => {
      const { token } = await createInvite(db, await access("owner"), { email: "x@example.com", role: "member" });
      const [row] = await db.select().from(invites);
      expect(row?.tokenHash).not.toBe(token);
      expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("revokes the earlier pending invite when re-inviting the same email", async () => {
      const a = await access("owner");
      const first = await createInvite(db, a, { email: "x@example.com", role: "member" });
      await createInvite(db, a, { email: "x@example.com", role: "read_only" });
      expect((await getInvitePreview(db, first.token)).status).toBe("revoked");
      expect(await listInvites(db, a)).toHaveLength(1);
    });

    it("refuses to invite an existing member", async () => {
      await addMember("member", "member");
      await rejects(createInvite(db, await access("owner"), { email: "member@example.com", role: "read_only" }), 409);
    });

    it("accepts with the invite's role, for the invited email only, and is idempotent", async () => {
      const { token } = await createInvite(db, await access("owner"), { email: "guest@example.com", role: "read_only" });
      await addUser("intruder");
      await rejects(acceptInvite(db, { token, userId: "intruder", userEmail: "intruder@example.com" }), 403, "wrong_email");
      expect(await membership("intruder")).toBeUndefined();

      await addUser("guest");
      const first = await acceptInvite(db, { token, userId: "guest", userEmail: "Guest@Example.com" });
      const second = await acceptInvite(db, { token, userId: "guest", userEmail: "guest@example.com" });
      expect(first).toEqual(second);
      expect((await membership("guest"))?.role).toBe("read_only");
      expect((await getInvitePreview(db, token)).status).toBe("accepted");
    });

    it("never creates a membership from an expired invite", async () => {
      const created = new Date("2026-01-01T00:00:00Z");
      const { token } = await createInvite(db, await access("owner"), { email: "late@example.com", role: "member" }, created);
      await addUser("late");
      const afterExpiry = new Date(created.getTime() + INVITE_TTL_MS + 1);
      await rejects(acceptInvite(db, { token, userId: "late", userEmail: "late@example.com" }, afterExpiry), 410, "expired");
      expect(await membership("late")).toBeUndefined();
    });

    it("never creates a membership from a revoked invite", async () => {
      const a = await access("owner");
      const { token, inviteId } = await createInvite(db, a, { email: "gone@example.com", role: "member" });
      await revokeInvite(db, a, inviteId);
      await addUser("gone");
      await rejects(acceptInvite(db, { token, userId: "gone", userEmail: "gone@example.com" }), 410, "revoked");
      expect(await membership("gone")).toBeUndefined();
    });

    it("rejects an unknown token", async () => {
      await rejects(acceptInvite(db, { token: "nope", userId: "owner", userEmail: "owner@example.com" }), 404);
    });
  });

  describe("members", () => {
    beforeEach(async () => {
      await addMember("admin", "admin");
      await addMember("member", "member");
      await addMember("client", "read_only");
    });

    it("lists members plus Account Owners", async () => {
      const list = await listMembers(db, await access("client"));
      expect(list.map((m) => [m.userId, m.role, m.viaAccount])).toEqual([
        ["admin", "admin", false],
        ["client", "read_only", false],
        ["member", "member", false],
        ["owner", "owner", true],
      ]);
    });

    it("lets an Admin move a Member to Read Only but not promote to Admin", async () => {
      const a = await access("admin");
      await changeMemberRole(db, a, { userId: "member", role: "read_only" });
      expect((await membership("member"))?.role).toBe("read_only");
      await rejects(changeMemberRole(db, a, { userId: "client", role: "admin" }), 403);
    });

    it("stops an Admin from changing or removing another Admin", async () => {
      await addMember("admin2", "admin");
      const a = await access("admin");
      await rejects(changeMemberRole(db, a, { userId: "admin2", role: "member" }), 403);
      await rejects(removeMember(db, a, "admin2"), 403);
    });

    it("protects Account Owners from per-workspace changes", async () => {
      await rejects(changeMemberRole(db, await access("owner"), { userId: "owner", role: "member" }), 409, "account_owner");
      await rejects(removeMember(db, await access("owner"), "owner"), 409, "account_owner");
    });

    it("lets anyone leave, and stops Members removing others", async () => {
      await rejects(removeMember(db, await access("member"), "client"), 403);
      await removeMember(db, await access("client"), "client");
      expect(await membership("client")).toBeUndefined();
    });
  });
});
