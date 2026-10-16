import { type Db, githubInstallationTokens } from "@gitwork/db";
import { eq } from "drizzle-orm";
import type { GitHubAppConfig } from "./config";
import { SEALED } from "./config";
import { type SecretBox, createAppJwt, importAppPrivateKey } from "./crypto";

const API = "https://api.github.com";
/** Refresh installation tokens this long before GitHub expires them. */
const TOKEN_MARGIN_MS = 5 * 60_000;

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** Primary or secondary rate limit. Callers stop and retry after `retryAt`. */
export class GitHubRateLimitError extends GitHubError {
  constructor(readonly retryAt: number) {
    super(429, "GitHub rate limit reached.");
    this.name = "GitHubRateLimitError";
  }
}

export interface GitHubClientOptions {
  db: Db;
  box: SecretBox;
  app: GitHubAppConfig;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Installation token, App JWT, or a linked user's own token (their App user token). */
export type GitHubAuth = { installationId: number } | { app: true } | { userToken: string };
type Auth = GitHubAuth;

/**
 * A small fetch-based GitHub client (Node + Workers). No retries that sleep: Workers cannot wait
 * long, so a rate limit throws GitHubRateLimitError and the caller (reconcile) stops early.
 */
export class GitHubClient {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private jwt: { value: string; expiresAt: number } | undefined;
  private key: CryptoKey | undefined;

  constructor(private readonly options: GitHubClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }

  private async appJwt(): Promise<string> {
    const now = this.now();
    if (this.jwt && this.jwt.expiresAt > now + 60_000) return this.jwt.value;
    this.key ??= await importAppPrivateKey(this.options.app.privateKeyPem);
    const value = await createAppJwt(this.options.app.appId, this.key, now);
    this.jwt = { value, expiresAt: now + 9 * 60_000 };
    return value;
  }

  /** An installation token, from the shared cache when it has at least 5 minutes left. */
  async installationToken(installationId: number): Promise<string> {
    const { db, box } = this.options;
    const now = this.now();
    const [cached] = await db
      .select()
      .from(githubInstallationTokens)
      .where(eq(githubInstallationTokens.installationId, installationId));
    if (cached && cached.expiresAt.getTime() > now + TOKEN_MARGIN_MS) {
      return box.open(cached.token, SEALED.installationToken);
    }
    const res = await this.raw("POST", `/app/installations/${installationId}/access_tokens`, { app: true });
    const { token, expires_at } = (await res.json()) as { token: string; expires_at: string };
    const sealed = await box.seal(token, SEALED.installationToken);
    const expiresAt = new Date(expires_at);
    await db
      .insert(githubInstallationTokens)
      .values({ installationId, token: sealed, expiresAt })
      .onConflictDoUpdate({ target: githubInstallationTokens.installationId, set: { token: sealed, expiresAt } });
    return token;
  }

  private async raw(method: string, pathOrUrl: string, auth: Auth, body?: unknown): Promise<Response> {
    const token =
      "app" in auth ? await this.appJwt() : "userToken" in auth ? auth.userToken : await this.installationToken(auth.installationId);
    const res = await this.fetch(pathOrUrl.startsWith("https://") ? pathOrUrl : `${API}${pathOrUrl}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "gitwork",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return res;
    if (res.status === 429 || (res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after")))) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const retryAt = retryAfter > 0 ? this.now() + retryAfter * 1000 : reset > 0 ? reset * 1000 : this.now() + 60_000;
      throw new GitHubRateLimitError(retryAt);
    }
    const data = await res.json().catch(() => undefined);
    throw new GitHubError(res.status, `GitHub ${method} ${pathOrUrl} failed: ${res.status}`, data);
  }

  async rest<T>(method: string, path: string, auth: Auth, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, auth, body);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  /** One page of a list, and the URL of the next page (from the `Link` header). */
  async page<T>(pathOrUrl: string, auth: Auth): Promise<{ items: T[]; next: string | null }> {
    const { data, next } = await this.pageOf<T[]>(pathOrUrl, auth);
    return { items: data, next };
  }

  /** One page of an endpoint that wraps its list in an object, e.g. `{ repositories: [...] }`. */
  async pageOf<T>(pathOrUrl: string, auth: Auth): Promise<{ data: T; next: string | null }> {
    const res = await this.raw("GET", pathOrUrl, auth);
    return {
      data: (await res.json()) as T,
      next: /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null,
    };
  }

  /** Follows `Link: rel="next"`, at most `maxPages` pages. `done` is false if pages remained. */
  async paginate<T>(path: string, auth: Auth, maxPages: number, onPage: (items: T[]) => Promise<void>): Promise<{ done: boolean }> {
    let url: string | null = path;
    for (let page = 0; url && page < maxPages; page++) {
      const res: Response = await this.raw("GET", url, auth);
      await onPage((await res.json()) as T[]);
      url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null;
    }
    return { done: url === null };
  }

  /**
   * `allowNotFound`: `nodes(ids:)` reports deleted ids as NOT_FOUND errors next to `null` entries;
   * that is an answer, not a failure.
   */
  async graphql<T>(
    auth: number | Auth,
    query: string,
    variables: Record<string, unknown>,
    options: { allowNotFound?: boolean } = {},
  ): Promise<T> {
    const res = await this.raw("POST", "/graphql", typeof auth === "number" ? { installationId: auth } : auth, { query, variables });
    const out = (await res.json()) as { data?: T; errors?: { type?: string; message: string }[] };
    if (out.errors?.some((e) => e.type === "RATE_LIMITED")) throw new GitHubRateLimitError(this.now() + 60_000);
    const errors = options.allowNotFound ? out.errors?.filter((e) => e.type !== "NOT_FOUND") : out.errors;
    if (errors?.length) throw new GitHubError(200, `GitHub GraphQL error: ${errors[0]!.message}`, errors);
    return out.data as T;
  }
}

/**
 * GitHub said "you cannot do this" (or "not found", which is how it hides private things), as
 * opposed to a rate limit or an outage. A user-token write that fails this way may retry as the App.
 */
export function isAccessDenied(error: unknown): boolean {
  if (!(error instanceof GitHubError) || error instanceof GitHubRateLimitError) return false;
  if (error.status === 401 || error.status === 403 || error.status === 404) return true;
  if (error.status === 200 && Array.isArray(error.body)) {
    return (error.body as { type?: string }[]).some((e) => e.type === "FORBIDDEN" || e.type === "NOT_FOUND" || e.type === "INSUFFICIENT_SCOPES");
  }
  return false;
}
