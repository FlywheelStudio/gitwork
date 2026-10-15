"use client";
import { safeRedirectPath } from "@gitwork/core";

/** Calls /api/v1 from the browser. Throws an Error with the API's message on failure. */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Request failed (${res.status}).`);
  return data as T;
}

/** Only same-site paths, so `?next=` cannot redirect off-site. */
export function safeNext(value: string | null): string {
  return safeRedirectPath(value, window.location.origin);
}
