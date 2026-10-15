/**
 * Instance setup: create the GitHub App through GitHub's manifest flow, and confirm installations.
 * Only instance admins (INSTANCE_ADMIN_EMAILS) may run it (decision 019).
 */
import { type Db, githubApp, githubInstallations, githubManifestStates } from "@gitwork/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { randomToken, sha256Hex } from "../crypto";
import { ServiceError, conflict, forbidden } from "../errors";
import type { GitHubClient } from "./client";
import { type GitHubAppConfig, SEALED } from "./config";
import type { SecretBox } from "./crypto";

const STATE_TTL_MS = 10 * 60_000;

export function parseAdminEmails(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isInstanceAdmin(email: string, adminEmails: string[]): boolean {
  return adminEmails.includes(email.toLowerCase());
}

export function buildManifest(baseURL: string, options: { name: string; public: boolean }) {
  const base = baseURL.replace(/\/$/, "");
  return {
    name: options.name,
    url: base,
    description: "Gitwork: GitHub tasks and docs for people outside GitHub.",
    public: options.public,
    hook_attributes: { url: `${base}/api/github/webhook`, active: true },
    redirect_url: `${base}/setup/github/callback`,
    callback_urls: [`${base}/api/auth/callback/github`],
    setup_url: `${base}/github/installed`,
    setup_on_update: true,
    request_oauth_on_install: false,
    default_permissions: {
      contents: "write",
      issues: "write",
      pull_requests: "write",
      metadata: "read",
      organization_projects: "write",
      members: "read",
      // Account permission: lets the GitHub link read a private profile email.
      email_addresses: "read",
    },
    default_events: [
      "issues",
      "issue_comment",
      "sub_issues",
      "issue_dependencies",
      "label",
      "push",
      "pull_request",
      "repository",
      "projects_v2",
      "projects_v2_item",
    ],
  };
}

/** Starts the flow: returns where to POST the manifest form. The state is single-use, 10 minutes. */
export async function startManifestFlow(
  db: Db,
  input: { userId: string; baseURL: string; org?: string; name?: string; public?: boolean },
  now = new Date(),
) {
  const [existing] = await db.select({ id: githubApp.id }).from(githubApp);
  if (existing) throw conflict("app_exists", "A GitHub App is already set up for this instance.");
  const org = input.org?.trim();
  if (org && !/^[A-Za-z0-9-]{1,39}$/.test(org)) throw new ServiceError(400, "invalid", "Enter a valid GitHub organization name.");
  const state = randomToken();
  await db.insert(githubManifestStates).values({
    stateHash: await sha256Hex(state),
    userId: input.userId,
    expiresAt: new Date(now.getTime() + STATE_TTL_MS),
  });
  const page = org ? `https://github.com/organizations/${org}/settings/apps/new` : "https://github.com/settings/apps/new";
  return {
    action: `${page}?state=${encodeURIComponent(state)}`,
    manifest: buildManifest(input.baseURL, { name: input.name?.trim() || "Gitwork", public: input.public ?? false }),
  };
}

interface Conversion {
  id: number;
  slug: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string;
  pem: string;
  html_url: string;
  owner: { login: string } | null;
}

/**
 * GitHub redirected back with `code` and `state`. The state must belong to this user, be unused,
 * and be unexpired; it is consumed atomically. An existing App is never overwritten.
 */
export async function completeManifestFlow(
  db: Db,
  box: SecretBox,
  input: { code: string; state: string; userId: string },
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<{ slug: string; htmlUrl: string }> {
  const consumed = await db
    .update(githubManifestStates)
    .set({ usedAt: now })
    .where(
      and(
        eq(githubManifestStates.stateHash, await sha256Hex(input.state)),
        eq(githubManifestStates.userId, input.userId),
        isNull(githubManifestStates.usedAt),
        gt(githubManifestStates.expiresAt, now),
      ),
    )
    .returning({ stateHash: githubManifestStates.stateHash });
  if (consumed.length === 0) throw forbidden("invalid_state", "This setup link expired or was already used. Start again.");
  const [existing] = await db.select({ id: githubApp.id }).from(githubApp);
  if (existing) throw conflict("app_exists", "A GitHub App is already set up for this instance.");

  const res = await fetchImpl(`https://api.github.com/app-manifests/${encodeURIComponent(input.code)}/conversions`, {
    method: "POST",
    headers: { accept: "application/vnd.github+json", "user-agent": "gitwork", "x-github-api-version": "2022-11-28" },
  });
  if (!res.ok) throw new ServiceError(400, "conversion_failed", "GitHub did not accept the setup code. Start again.");
  const app = (await res.json()) as Conversion;
  try {
    // Plain INSERT on the singleton key: a concurrent or replayed callback fails instead of overwriting.
    await db.insert(githubApp).values({
      id: 1,
      appId: String(app.id),
      slug: app.slug,
      clientId: app.client_id,
      clientSecret: await box.seal(app.client_secret, SEALED.clientSecret),
      webhookSecret: await box.seal(app.webhook_secret, SEALED.webhookSecret),
      privateKey: await box.seal(app.pem, SEALED.privateKey),
      htmlUrl: app.html_url,
      ownerLogin: app.owner?.login ?? "",
    });
  } catch {
    throw conflict("app_exists", "A GitHub App is already set up for this instance.");
  }
  return { slug: app.slug, htmlUrl: app.html_url };
}

/** Where an Owner/Admin goes to install the App on a GitHub org. */
export function installUrl(app: Pick<GitHubAppConfig, "slug" | "htmlUrl">): string {
  return `${app.htmlUrl || `https://github.com/apps/${app.slug}`}/installations/new`;
}

/**
 * The setup URL GitHub redirects to after an install carries an `installation_id` anyone can type.
 * Record it only after GitHub confirms it with the App's own JWT.
 */
export async function confirmInstallation(db: Db, client: GitHubClient, installationId: number) {
  const inst = await client.rest<{
    id: number;
    account: { login: string; id: number; type: string };
    repository_selection: string;
    suspended_at: string | null;
  }>("GET", `/app/installations/${installationId}`, { app: true });
  const row = {
    id: inst.id,
    accountLogin: inst.account.login,
    accountId: inst.account.id,
    accountType: inst.account.type,
    repositorySelection: inst.repository_selection,
    suspendedAt: inst.suspended_at ? new Date(inst.suspended_at) : null,
    deletedAt: null,
    updatedAt: new Date(),
  };
  await db.insert(githubInstallations).values(row).onConflictDoUpdate({ target: githubInstallations.id, set: { ...row, id: undefined } });
  return { accountLogin: inst.account.login };
}
