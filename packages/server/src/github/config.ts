import { type Db, githubApp } from "@gitwork/db";
import { eq } from "drizzle-orm";
import type { SecretBox } from "./crypto";

export interface GitHubAppConfig {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  privateKeyPem: string;
  htmlUrl: string;
  source: "env" | "database";
}

/** Purpose labels bind each sealed column to its ciphertext. */
export const SEALED = {
  clientSecret: "github_app.client_secret",
  webhookSecret: "github_app.webhook_secret",
  privateKey: "github_app.private_key",
  installationToken: "github_installation_tokens.token",
} as const;

/**
 * The App's credentials. Environment variables win (the hosted version sets them); otherwise the
 * row the setup wizard stored. Null when the App is not set up yet.
 */
export async function loadGitHubAppConfig(
  db: Db,
  box: SecretBox,
  env: Record<string, string | undefined>,
): Promise<GitHubAppConfig | null> {
  if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_WEBHOOK_SECRET && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    return {
      appId: env.GITHUB_APP_ID,
      slug: env.GITHUB_APP_SLUG ?? "",
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
      // Env vars often carry the PEM with literal "\n".
      privateKeyPem: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
      htmlUrl: env.GITHUB_APP_SLUG ? `https://github.com/apps/${env.GITHUB_APP_SLUG}` : "",
      source: "env",
    };
  }
  const [row] = await db.select().from(githubApp).where(eq(githubApp.id, 1));
  if (!row) return null;
  return {
    appId: row.appId,
    slug: row.slug,
    clientId: row.clientId,
    clientSecret: await box.open(row.clientSecret, SEALED.clientSecret),
    webhookSecret: await box.open(row.webhookSecret, SEALED.webhookSecret),
    privateKeyPem: await box.open(row.privateKey, SEALED.privateKey),
    htmlUrl: row.htmlUrl,
    source: "database",
  };
}
