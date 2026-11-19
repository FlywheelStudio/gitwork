"use client";
import type { DocView, WriteResult } from "@gitwork/server";

/** A failed docs call, with the API's code and extra fields (e.g. the current text on a conflict). */
export class DocsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly data: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } & Record<string, unknown> };
  if (!res.ok) throw new DocsApiError(res.status, data.error?.code ?? "error", data.error?.message ?? `Request failed (${res.status}).`, data.error ?? {});
  return data as T;
}

export function docsApi(workspaceId: string) {
  const base = `/api/v1/workspaces/${workspaceId}/docs`;
  const q = (repo: string, path: string, extra = "") => `?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}${extra}`;
  return {
    get: (repo: string, path: string) => call<{ doc: DocView }>("GET", `${base}/file${q(repo, path)}`).then((r) => r.doc),
    save: (body: { repoNodeId: string; path: string; baseSha: string; text: string; attachments?: { path: string; data: string }[] }) =>
      call<WriteResult>("PUT", `${base}/file`, body),
    rename: (body: { repoNodeId: string; path: string; baseSha: string; newPath: string }) => call<WriteResult>("POST", `${base}/rename`, body),
    remove: (repo: string, path: string, sha: string) => call<WriteResult>("DELETE", `${base}/file${q(repo, path, `&sha=${sha}`)}`),
    heartbeat: (repoNodeId: string, path: string) =>
      call<{ editors: { userId: string; name: string }[] }>("POST", `${base}/presence`, { repoNodeId, path }).then((r) => r.editors),
    leave: (repo: string, path: string) => call<void>("DELETE", `${base}/presence${q(repo, path)}`, undefined, { keepalive: true }),
  };
}
