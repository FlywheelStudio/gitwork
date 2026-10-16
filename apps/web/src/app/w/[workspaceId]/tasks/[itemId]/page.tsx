import { can } from "@gitwork/core";
import { ServiceError, getTask, listTasks } from "@gitwork/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { Card } from "@/components/kit";
import { Badge } from "@/components/ui/badge";
import { requireWorkspacePage } from "@/server/pages";
import { WorkspaceNav } from "../../workspace-nav";
import { editableFields, fieldText } from "../fields";
import { TaskEditor } from "./task-editor";

export default async function TaskPage({ params }: PageProps<"/w/[workspaceId]/tasks/[itemId]">) {
  const { workspaceId, itemId: rawId } = await params;
  const itemId = decodeURIComponent(rawId);
  const { user, access, db } = await requireWorkspacePage(workspaceId, `/w/${workspaceId}/tasks/${rawId}`);
  const task = await getTask(db, access, itemId).catch((e: unknown) => {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  });
  const board = await listTasks(db, access);
  const fields = board.linked ? editableFields(board.fields) : [];
  const canWrite = can(access.actor, "tasks.write", access.settings);
  const titleOf = (id: string) => (board.linked ? board.tasks.find((t) => t.id === id)?.title : undefined) ?? id;

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto w-full max-w-4xl flex-1 p-6">
        <WorkspaceNav id={workspaceId} name={access.workspace.name} role={access.role} />
        <Link href={`/w/${workspaceId}`} className="text-sm text-muted-foreground hover:underline">
          ← All tasks
        </Link>
        <Card className="mt-3 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {task.kind === "draft" ? <Badge variant="outline">Draft</Badge> : <span>{task.repo?.fullName}#{task.number}</span>}
            {task.state && <Badge variant={task.state === "open" ? "default" : "secondary"}>{task.state === "open" ? "Open" : "Closed"}</Badge>}
            {task.url && (
              <a href={task.url} className="hover:underline">
                View on GitHub
              </a>
            )}
          </div>
          <h2 className="text-xl font-semibold">{task.title}</h2>
          {task.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {task.labels.map((l) => (
                <Badge key={l.name} variant="outline">
                  {l.name}
                </Badge>
              ))}
            </div>
          )}
          {/* Plain text on purpose: issue bodies are user content (markdown rendering comes with Phase 4). */}
          <div className="text-sm whitespace-pre-wrap">{task.body || <span className="text-muted-foreground">No description.</span>}</div>
          <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 text-sm">
            {fields.map((f) => (
              <div key={f.id} className="contents">
                <dt className="text-muted-foreground">{f.name}</dt>
                <dd>{fieldText(task.fields[f.id]) || "—"}</dd>
              </div>
            ))}
            {task.parentId && (
              <div className="contents">
                <dt className="text-muted-foreground">Parent</dt>
                <dd>
                  <Link href={`/w/${workspaceId}/tasks/${encodeURIComponent(task.parentId)}`} className="hover:underline">
                    {titleOf(task.parentId)}
                  </Link>
                </dd>
              </div>
            )}
            {task.blockedBy.length > 0 && (
              <div className="contents">
                <dt className="text-muted-foreground">Blocked by</dt>
                <dd className="space-x-2">
                  {task.blockedBy.map((id) => (
                    <Link key={id} href={`/w/${workspaceId}/tasks/${encodeURIComponent(id)}`} className="hover:underline">
                      {titleOf(id)}
                    </Link>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </Card>
        {canWrite && <TaskEditor workspaceId={workspaceId} task={task} fields={fields} />}
      </main>
    </>
  );
}
