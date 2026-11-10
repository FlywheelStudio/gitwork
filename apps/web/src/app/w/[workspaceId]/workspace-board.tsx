"use client";
import { useBoard, useBoardState, useSnapshot } from "./board-context";
import { NewTaskButton } from "./tasks/new-task";
import { ListView } from "./tasks/task-list";
import { KanbanView, TimelineView } from "./tasks/task-views";
import { VIEWS } from "./views";

/** The tasks area. The store, panel, and keys live in the workspace layout (workspace-shell.tsx). */
export function WorkspaceBoard() {
  const board = useBoard();
  const { canWrite } = useSnapshot();
  const { peekId, view, setView } = useBoardState();

  return (
    <div className={peekId ? "lg:pr-[28rem]" : undefined}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <nav aria-label="Views" className="inline-flex rounded-lg bg-muted p-0.5 text-sm">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                title={`${v.label} view (V then ${v.label[0]})`}
                aria-current={v.id === view ? "page" : undefined}
                className={`rounded-md px-3 py-1 ${v.id === view ? "bg-background font-medium shadow-xs" : "text-muted-foreground"}`}
              >
                {v.label}
              </button>
            ))}
          </nav>
          {board.board.url && (
            <a href={board.board.url} className="text-sm text-muted-foreground hover:underline">
              {board.board.title} on GitHub
            </a>
          )}
        </div>
        {canWrite && board.board.available && board.repos.length > 0 && <NewTaskButton />}
      </div>
      {!board.board.available && <p className="mb-4 text-sm text-destructive">The GitHub board is not reachable right now.</p>}
      {view === "list" && <ListView />}
      {view === "board" && <KanbanView />}
      {view === "timeline" && <TimelineView />}
    </div>
  );
}
