import type { Database } from "@gitwork/db";
import type { ApiDeps } from "./api/router";
import { createAuth } from "./auth";
import type { EmailSender } from "./email";
import { GitHubClient } from "./github/client";
import { type GitHubAppConfig, loadGitHubAppConfig } from "./github/config";
import { SecretBoxError, createSecretBox } from "./github/crypto";

export interface RequestDepsInput {
  database: Database;
  env: Record<string, string | undefined>;
  email: EmailSender;
  secret: string;
  baseURL: string;
  trustedIpHeader?: string;
  instanceAdminEmails: string[];
  fetch?: typeof fetch;
}

/**
 * Everything a request needs. A stored GitHub App that cannot be decrypted (BETTER_AUTH_SECRET
 * changed) must not take sign-in down with it: GitHub is then treated as not set up, with
 * `githubError` set so /setup can offer to replace the App.
 */
export async function createRequestDeps(input: RequestDepsInput): Promise<ApiDeps & { githubError: "undecryptable" | null }> {
  const { database, env } = input;
  const box = await createSecretBox(input.secret);
  let app: GitHubAppConfig | null = null;
  let githubError: "undecryptable" | null = null;
  try {
    app = await loadGitHubAppConfig(database.db, box, env);
  } catch (error) {
    if (!(error instanceof SecretBoxError)) throw error;
    githubError = "undecryptable";
  }
  const github = app ? { app, client: new GitHubClient({ db: database.db, box, app, fetch: input.fetch }) } : null;
  // Linking GitHub uses the App's OAuth credentials; plain client id/secret env vars also work.
  const oauth = app
    ? { clientId: app.clientId, clientSecret: app.clientSecret }
    : env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
      : undefined;
  const auth = createAuth({
    database,
    email: input.email,
    secret: input.secret,
    baseURL: input.baseURL,
    github: oauth,
    trustedIpHeader: input.trustedIpHeader,
    instanceAdminEmails: input.instanceAdminEmails,
  });
  return {
    database,
    auth,
    email: input.email,
    baseURL: input.baseURL,
    instanceAdminEmails: input.instanceAdminEmails,
    box,
    github,
    githubError,
  };
}
