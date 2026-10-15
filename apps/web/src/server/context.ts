import "server-only";
import { type ApiDeps, createAuth } from "@gitwork/server";
import { headers } from "next/headers";
import { DEFAULT_TRUSTED_IP_HEADER, getDatabase, getEmailSender, getEnv } from "./runtime";

const DEV_SECRET = "gitwork-development-secret-not-for-production";

export function getConfig() {
  const env = getEnv();
  const dev = process.env.NODE_ENV === "development";
  const secret = env.BETTER_AUTH_SECRET || (dev ? DEV_SECRET : undefined);
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set.");
  // Links in emails and the same-origin check both use it, so production must set the real URL.
  const baseURL = env.BETTER_AUTH_URL || (dev ? "http://localhost:3000" : undefined);
  if (!baseURL) throw new Error("BETTER_AUTH_URL is not set.");
  const trustedIpHeader = env.TRUSTED_IP_HEADER || DEFAULT_TRUSTED_IP_HEADER;
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
      : undefined;
  return { secret, baseURL, github, trustedIpHeader };
}

/** Everything a request needs. Built per request: D1 bindings are per request. */
export function getDeps(): ApiDeps {
  const config = getConfig();
  const database = getDatabase();
  const email = getEmailSender();
  const auth = createAuth({ database, email, ...config });
  return { database, auth, email, baseURL: config.baseURL };
}

export async function getSession() {
  // Read the request first: it marks the page dynamic before any config is read at build time.
  const requestHeaders = await headers();
  return getDeps().auth.api.getSession({ headers: requestHeaders });
}
