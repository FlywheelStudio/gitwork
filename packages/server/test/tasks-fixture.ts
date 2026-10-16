/**
 * A workspace, an org, and a board for Phase 3 tests.
 *
 * Org "acme" (installation 99): repos acme/site, acme/internal, acme/secret. Board PVT_1 with
 * Status (Todo/Doing/Done), Start date, Target date, and items: site#1, site#2 (label "Internal"),
 * site#3 (sub-issue of site#2, blocked by internal#1), internal#1, a draft, a pull request, and an
 * archived item. Org "globex" (installation 100): repo globex/app, board PVT_9.
 *
 * Users: jane (ghu_jane) sees acme/site, acme/internal, PVT_1, PVT_9 and both installations' orgs
 * only through 99 — she cannot see installation 100 or acme/secret. The App can reach everything.
 */
import { type Database, authIdentities, githubInstallations, users, workspaceMembers } from "@gitwork/db";
import { createAccountWithWorkspace } from "../src/services/accounts";
import { requireWorkspaceAccess } from "../src/services/access";
import { FakeGitHub, type FakeProject } from "./fake-github";
import { APP } from "./github-helpers";
import { GitHubClient } from "../src/github/client";
import { createSecretBox } from "../src/github/crypto";

export const IDS = {
  site: "R_site",
  internal: "R_internal",
  secret: "R_secret",
  globexApp: "R_globex",
  board: "PVT_1",
  globexBoard: "PVT_9",
  status: "F_status",
  start: "F_start",
  target: "F_target",
  todo: "opt-todo",
  doing: "opt-doing",
  done: "opt-done",
};

const issueId = (repo: string, n: number) => `I_${repo}#${n}`;

export function seedFake(fake: FakeGitHub) {
  fake.addRepo("acme/site", IDS.site, 1);
  fake.addRepo("acme/internal", IDS.internal, 2);
  fake.addRepo("acme/secret", IDS.secret, 3);
  fake.addRepo("globex/app", IDS.globexApp, 4);
  fake.installationAccounts.set(100, "globex");
  fake.installationRepos.set(99, new Set(["acme/site", "acme/internal", "acme/secret"]));
  fake.installationRepos.set(100, new Set(["globex/app"]));
  const t = "2026-05-01T00:00:00Z";
  fake.putIssue("acme/site", { number: 1, title: "Homepage hero", updated_at: t });
  fake.putIssue("acme/site", { number: 2, title: "Internal pricing notes", labels: [{ name: "Internal", color: "f00" }], updated_at: t });
  fake.putIssue("acme/site", { number: 3, title: "Pricing table", updated_at: t });
  fake.putIssue("acme/internal", { number: 1, title: "Secret roadmap", updated_at: t });
  fake.links.set(issueId("acme/site", 3), { parent: issueId("acme/site", 2), blockedBy: [issueId("acme/internal", 1), issueId("acme/site", 1)] });

  const fieldValue = (option: string, name: string) => ({
    nodes: [{ __typename: "ProjectV2ItemFieldSingleSelectValue", optionId: option, name, field: { id: IDS.status } }],
  });
  const board: FakeProject = {
    id: IDS.board,
    number: 1,
    title: "Website",
    owner: "acme",
    fields: [
      {
        id: IDS.status,
        name: "Status",
        dataType: "SINGLE_SELECT",
        options: [
          { id: IDS.todo, name: "Todo", color: "GRAY" },
          { id: IDS.doing, name: "Doing", color: "YELLOW" },
          { id: IDS.done, name: "Done", color: "GREEN" },
        ],
      },
      { id: IDS.start, name: "Start date", dataType: "DATE" },
      { id: IDS.target, name: "Target date", dataType: "DATE" },
      { id: "F_title", name: "Title", dataType: "TITLE" },
    ],
    items: [
      { id: "PVTI_site1", type: "ISSUE", isArchived: false, updatedAt: t, content: { id: issueId("acme/site", 1) }, fieldValues: fieldValue(IDS.todo, "Todo") },
      { id: "PVTI_site2", type: "ISSUE", isArchived: false, updatedAt: t, content: { id: issueId("acme/site", 2) }, fieldValues: fieldValue(IDS.doing, "Doing") },
      { id: "PVTI_site3", type: "ISSUE", isArchived: false, updatedAt: t, content: { id: issueId("acme/site", 3) }, fieldValues: { nodes: [] } },
      { id: "PVTI_int1", type: "ISSUE", isArchived: false, updatedAt: t, content: { id: issueId("acme/internal", 1) }, fieldValues: fieldValue(IDS.todo, "Todo") },
      { id: "PVTI_draft", type: "DRAFT_ISSUE", isArchived: false, updatedAt: t, content: { id: "DI_1", title: "Idea: dark mode", body: "Maybe" }, fieldValues: { nodes: [] } },
      { id: "PVTI_pr", type: "PULL_REQUEST", isArchived: false, updatedAt: t, content: { id: "PR_1" }, fieldValues: { nodes: [] } },
      { id: "PVTI_old", type: "ISSUE", isArchived: true, updatedAt: t, content: { id: issueId("acme/site", 1) }, fieldValues: { nodes: [] } },
    ],
  };
  fake.projects.set(board.id, board);
  fake.projects.set(IDS.globexBoard, { id: IDS.globexBoard, number: 9, title: "Globex", owner: "globex", fields: [], items: [] });

  fake.addUser("ghu_jane", {
    login: "jane",
    installations: new Set([99]),
    repos: new Set(["acme/site", "acme/internal"]),
    projects: new Set([IDS.board, IDS.globexBoard]),
  });
  // Linked, but her GitHub account sees nothing in acme: her writes go through the App.
  fake.addUser("ghu_sam", { login: "sam", installations: new Set([99]) });
}

/** Better Auth stand-in for user tokens: the token is `ghu_<userId>`. */
export const tokenAuth = {
  api: {
    getAccessToken: async ({ body }: { body: { userId?: string } }) => ({ accessToken: `ghu_${body.userId}` }),
    refreshToken: async ({ body }: { body: { userId?: string } }) => ({ accessToken: `ghu_${body.userId}` }),
  },
} as never;

export async function setupWorkspace(database: Database) {
  const { db } = database;
  const fake = new FakeGitHub();
  seedFake(fake);
  const box = await createSecretBox("test-secret");
  const client = new GitHubClient({ db, box, app: APP, fetch: fake.fetch });
  await db.insert(githubInstallations).values([
    { id: 99, accountLogin: "acme", accountId: 7, accountType: "Organization" },
    { id: 100, accountLogin: "globex", accountId: 8, accountType: "Organization" },
  ]);
  await db.insert(users).values([
    { id: "owner", name: "Olive Owner", email: "owner@example.com", emailVerified: true },
    { id: "jane", name: "Jane Admin", email: "jane@example.com", emailVerified: true },
    { id: "sam", name: "Sam Member", email: "sam@example.com", emailVerified: true },
    { id: "max", name: "Max Member", email: "max@example.com", emailVerified: true },
    { id: "rita", name: "Rita Reader", email: "rita@example.com", emailVerified: true },
  ]);
  const ws = await createAccountWithWorkspace(db, { userId: "owner", accountName: "Acme", workspaceName: "Website" });
  await db.insert(workspaceMembers).values([
    { workspaceId: ws.workspaceId, userId: "jane", role: "admin" },
    { workspaceId: ws.workspaceId, userId: "sam", role: "member" },
    { workspaceId: ws.workspaceId, userId: "max", role: "member" },
    { workspaceId: ws.workspaceId, userId: "rita", role: "read_only" },
  ]);
  // jane and sam linked GitHub; max, rita, and the owner did not. Emails are verified: Better
  // Auth deletes linked identities of an unverified user when they first sign in by code.
  await db.insert(authIdentities).values([
    { id: "ident-jane", accountId: "1001", providerId: "github", userId: "jane", accessTokenExpiresAt: new Date(Date.now() + 3_600_000) },
    { id: "ident-sam", accountId: "1002", providerId: "github", userId: "sam", accessTokenExpiresAt: new Date(Date.now() + 3_600_000) },
  ]);
  const access = (userId: string) => requireWorkspaceAccess(db, userId, ws.workspaceId);
  const deps = { db, client, auth: tokenAuth };
  return { fake, client, db, ws, access, deps };
}
