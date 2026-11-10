import { can } from "@gitwork/core";
import type { Db } from "@gitwork/db";
import { type WorkspaceAccess, hasLinkedGitHub } from "./access";
import { type BoardView, listTasks } from "./tasks";

/**
 * Everything a client needs to render a workspace's tasks (decision 033). Built from the same
 * filtered read as GET /tasks, so it holds only what this viewer may see.
 */
export interface BoardSnapshot {
  role: WorkspaceAccess["role"];
  canWrite: boolean;
  /**
   * The viewer's own state. `githubLinked` decides what the UI says a save does: write to GitHub
   * as the viewer, or as the App with the viewer's name (decisions 008, 021).
   */
  viewer: { githubLinked: boolean };
  board: BoardView;
}

export async function boardSnapshot(db: Db, access: WorkspaceAccess): Promise<BoardSnapshot> {
  return {
    role: access.role,
    canWrite: can(access.actor, "tasks.write", access.settings),
    viewer: { githubLinked: await hasLinkedGitHub(db, access.userId) },
    board: await listTasks(db, access),
  };
}

/**
 * A strong ETag over the exact bytes this viewer receives. A change only to items the viewer
 * cannot see leaves the bytes, and so the ETag, unchanged: polling reveals nothing about them.
 */
export async function snapshotEtag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return `"${b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}"`;
}

/** The serialized snapshot and its ETag, for the API route and the server-rendered page alike. */
export async function serializedSnapshot(db: Db, access: WorkspaceAccess): Promise<{ body: string; etag: string }> {
  const body = JSON.stringify(await boardSnapshot(db, access));
  return { body, etag: await snapshotEtag(body) };
}
