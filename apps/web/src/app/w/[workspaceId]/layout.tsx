import { type BoardSnapshot, serializedSnapshot } from "@gitwork/server";
import { requireWorkspacePage } from "@/server/pages";
import { WorkspaceShell } from "./workspace-shell";

/**
 * Every workspace page shares one store, one sidebar, and one key layer: the store survives
 * moving between tasks, members, and settings, and the shortcuts work on every page.
 */
export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[workspaceId]">) {
  const { workspaceId } = await params;
  // Reads the session (the request) first, before any config: see CLAUDE.md.
  const { user, access, db } = await requireWorkspacePage(workspaceId, `/w/${workspaceId}`);
  // The same bytes and ETag as GET /sync, so the client's first poll is a 304.
  const { body, etag } = await serializedSnapshot(db, access);
  return (
    <WorkspaceShell
      workspaceId={workspaceId}
      name={access.workspace.name}
      role={access.role}
      email={user.email}
      initial={JSON.parse(body) as BoardSnapshot}
      etag={etag}
    >
      {children}
    </WorkspaceShell>
  );
}
