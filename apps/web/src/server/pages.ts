import "server-only";
import { ServiceError, getWorkspaceAccess } from "@gitwork/server";
import { notFound, redirect } from "next/navigation";
import { getDeps, getSession } from "./context";

/** The signed-in user, or a redirect to sign-in that returns to `path`. */
export async function requireUser(path: string) {
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(path)}`);
  return session.user;
}

/** The user's access to a workspace; 404 when they have none. */
export async function requireWorkspacePage(workspaceId: string, path: string) {
  const user = await requireUser(path);
  const { database } = getDeps();
  const access = await getWorkspaceAccess(database.db, user.id, workspaceId);
  if (!access) notFound();
  return { user, access, db: database.db };
}

export function messageOf(error: unknown): string {
  return error instanceof ServiceError ? error.message : "Something went wrong.";
}
