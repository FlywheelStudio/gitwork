/**
 * The /api/v1 router (decision 015). Framework-free: takes a Request, returns a Response, so the
 * same code runs under Next.js on Node and Workers, and in tests without a server.
 */
import type { Database } from "@gitwork/db";
import { z } from "zod";
import type { Auth } from "../auth";
import type { EmailSender } from "../email";
import type { GitHubClient } from "../github/client";
import type { GitHubAppConfig } from "../github/config";
import type { SecretBox } from "../github/crypto";
import { ServiceError } from "../errors";

export interface ApiDeps {
  database: Database;
  auth: Auth;
  email: EmailSender;
  baseURL: string;
  /** Lowercase INSTANCE_ADMIN_EMAILS. */
  instanceAdminEmails?: string[];
  box?: SecretBox;
  /** The App and a client for it; null until setup creates the App. */
  github?: { app: GitHubAppConfig; client: GitHubClient } | null;
}

export interface Session {
  user: { id: string; email: string; name: string };
}

export interface RouteContext<P extends string = string> {
  deps: ApiDeps;
  request: Request;
  params: Record<P, string>;
  session: Session | null;
  /** Parsed and validated JSON body. */
  body: unknown;
}

interface Route {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  pattern: string;
  auth: boolean;
  body?: z.ZodType;
  handler: (ctx: RouteContext) => Promise<unknown>;
}

export function route<B extends z.ZodType | undefined = undefined>(def: {
  method: Route["method"];
  pattern: string;
  auth?: boolean;
  body?: B;
  handler: (ctx: RouteContext & { body: B extends z.ZodType ? z.infer<B> : undefined }) => Promise<unknown>;
}): Route {
  return { auth: true, ...def, handler: def.handler as Route["handler"] };
}

function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(s[i]!);
    else if (seg !== s[i]) return null;
  }
  return params;
}

const json = (status: number, data: unknown) => Response.json(data, { status });
const error = (status: number, code: string, message: string) => json(status, { error: { code, message } });

/**
 * Cookie-authenticated writes must come from our own origin. Next.js route handlers get no CSRF
 * protection of their own. Bearer-token clients (the Mac app) are exempt: browsers never attach
 * those automatically.
 */
function sameOrigin(request: Request, baseURL: string): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(baseURL).origin;
}

export function createApiHandler(routes: Route[], prefix = "/api/v1") {
  return async function handle(request: Request, deps: ApiDeps): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
    let allowed = false;
    for (const r of routes) {
      const params = match(r.pattern, path);
      if (!params) continue;
      allowed = true;
      if (r.method !== request.method) continue;
      try {
        let session: Session | null = null;
        if (r.auth) {
          session = (await deps.auth.api.getSession({ headers: request.headers })) as Session | null;
          if (!session) return error(401, "unauthenticated", "Sign in first.");
          const usesBearer = request.headers.get("authorization")?.startsWith("Bearer ") ?? false;
          if (request.method !== "GET" && !usesBearer && !sameOrigin(request, deps.baseURL)) {
            return error(403, "cross_site", "Cross-site request refused.");
          }
        }
        let body: unknown;
        if (r.body) {
          const raw = await request.json().catch(() => undefined);
          const parsed = r.body.safeParse(raw);
          if (!parsed.success) return error(400, "invalid", parsed.error.issues[0]?.message ?? "Invalid request body.");
          body = parsed.data;
        }
        const result = await r.handler({ deps, request, params, session, body });
        if (result instanceof Response) return result;
        return result === undefined ? new Response(null, { status: 204 }) : json(200, result);
      } catch (e) {
        if (e instanceof ServiceError) return error(e.status, e.code, e.message);
        console.error("[api]", e);
        return error(500, "internal", "Something went wrong.");
      }
    }
    return allowed ? error(405, "method_not_allowed", "Method not allowed.") : error(404, "not_found", "Not found.");
  };
}
