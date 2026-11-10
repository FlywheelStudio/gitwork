import { authorize } from "@gitwork/core";
import { type BoardSnapshot, installUrl, serializedSnapshot } from "@gitwork/server";
import Link from "next/link";
import { Header } from "@/components/header";
import { Card } from "@/components/kit";
import { getDeps } from "@/server/context";
import { requireWorkspacePage } from "@/server/pages";
import { VIEWS } from "./views";
import { WorkspaceBoard } from "./workspace-board";
import { WorkspaceNav } from "./workspace-nav";

export default async function WorkspacePage({ params, searchParams }: PageProps<"/w/[workspaceId]">) {
  const { workspaceId } = await params;
  const { view: viewParam } = await searchParams;
  const { user, access, db } = await requireWorkspacePage(workspaceId, `/w/${workspaceId}`);
  // The same bytes and ETag as GET /sync, so the client's first poll is a 304.
  const { body, etag } = await serializedSnapshot(db, access);
  const snapshot = JSON.parse(body) as BoardSnapshot;
  const view = VIEWS.find((v) => v.id === viewParam)?.id ?? "list";

  if (!snapshot.board.linked) {
    const { github } = await getDeps();
    const install = authorize(access.actor, "github.install_app", access.settings);
    return (
      <>
        <Header email={user.email} />
        <main className="mx-auto w-full max-w-6xl flex-1 p-6">
          <WorkspaceNav id={workspaceId} name={access.workspace.name} role={access.role} />
          <Card className="space-y-3">
            <p className="text-sm text-muted-foreground">Tasks arrive once this workspace is linked to a GitHub board and repos.</p>
            {install.ok && github && (
              <div className="flex flex-wrap gap-4 text-sm">
                <a href={installUrl(github.app)} className="font-medium underline">
                  Install the GitHub App on your organization
                </a>
                <Link href={`/w/${workspaceId}/settings`} className="font-medium underline">
                  Link a board and repos
                </Link>
              </div>
            )}
            {!install.ok && install.reason === "github_link_required" && (
              <p className="text-sm">
                <Link href="/settings" className="underline">
                  Link your GitHub account
                </Link>{" "}
                to install the GitHub App and connect repos.
              </p>
            )}
            {install.ok && !github && <p className="text-sm text-muted-foreground">The GitHub App is not set up on this instance yet.</p>}
          </Card>
        </main>
      </>
    );
  }

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto w-full max-w-6xl flex-1 p-6">
        <WorkspaceNav id={workspaceId} name={access.workspace.name} role={access.role} />
        <WorkspaceBoard workspaceId={workspaceId} initial={snapshot} etag={etag} initialView={view} />
      </main>
    </>
  );
}
