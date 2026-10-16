import { authorize, can } from "@gitwork/core";
import { installUrl, listTasks } from "@gitwork/server";
import Link from "next/link";
import { Header } from "@/components/header";
import { Card } from "@/components/kit";
import { getDeps } from "@/server/context";
import { requireWorkspacePage } from "@/server/pages";
import { NewTaskButton } from "./tasks/new-task";
import { KanbanView, ListView, TimelineView } from "./tasks/task-views";
import { WorkspaceNav } from "./workspace-nav";

const VIEWS = [
  { id: "list", label: "List" },
  { id: "board", label: "Board" },
  { id: "timeline", label: "Timeline" },
] as const;

export default async function WorkspacePage({ params, searchParams }: PageProps<"/w/[workspaceId]">) {
  const { workspaceId } = await params;
  const { view: viewParam } = await searchParams;
  const { user, access, db } = await requireWorkspacePage(workspaceId, `/w/${workspaceId}`);
  const board = await listTasks(db, access);
  const view = VIEWS.find((v) => v.id === viewParam)?.id ?? "list";

  if (!board.linked) {
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

  const canWrite = can(access.actor, "tasks.write", access.settings);
  const props = { workspaceId, tasks: board.tasks, fields: board.fields, mapping: board.mapping, canWrite };
  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto w-full max-w-6xl flex-1 p-6">
        <WorkspaceNav id={workspaceId} name={access.workspace.name} role={access.role} />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <nav aria-label="Views" className="inline-flex rounded-lg bg-muted p-0.5 text-sm">
              {VIEWS.map((v) => (
                <Link
                  key={v.id}
                  href={`/w/${workspaceId}?view=${v.id}`}
                  aria-current={v.id === view ? "page" : undefined}
                  className={`rounded-md px-3 py-1 ${v.id === view ? "bg-background font-medium shadow-xs" : "text-muted-foreground"}`}
                >
                  {v.label}
                </Link>
              ))}
            </nav>
            {board.board.url && (
              <a href={board.board.url} className="text-sm text-muted-foreground hover:underline">
                {board.board.title} on GitHub
              </a>
            )}
          </div>
          {canWrite && board.board.available && board.repos.length > 0 && (
            <NewTaskButton
              workspaceId={workspaceId}
              repos={board.repos}
              defaultRepo={board.lastRepoNodeId}
              statusField={board.fields.find((f) => f.id === board.mapping.kanbanFieldId) ?? null}
            />
          )}
        </div>
        {!board.board.available && <p className="mb-4 text-sm text-destructive">The GitHub board is not reachable right now.</p>}
        {view === "list" && <ListView {...props} />}
        {view === "board" && <KanbanView {...props} />}
        {view === "timeline" && <TimelineView {...props} />}
      </main>
    </>
  );
}
