"use client";
import { useState } from "react";
import type { Snapshot } from "@/lib/board-store";
import { BoardProvider, useBoard, useBoardContext, useSnapshot, useSyncState } from "./board-context";
import { PeekPanel } from "./tasks/peek-panel";
import { NewTaskButton } from "./tasks/new-task";
import { KanbanView, ListView, TimelineView } from "./tasks/task-views";
import { VIEWS, type ViewId } from "./views";

/** The tasks area of a linked workspace. View switches stay in the browser: no server render. */
export function WorkspaceBoard(props: { workspaceId: string; initial: Snapshot; etag: string; initialView: ViewId }) {
  return (
    <BoardProvider workspaceId={props.workspaceId} initial={props.initial} etag={props.etag}>
      <Board initialView={props.initialView} />
    </BoardProvider>
  );
}

function Board({ initialView }: { initialView: ViewId }) {
  const [view, setView] = useState<ViewId>(initialView);
  const board = useBoard();
  const { canWrite } = useSnapshot();
  const { peekId, notice } = useBoardContext();

  function show(next: ViewId) {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <div className={peekId ? "lg:pr-[28rem]" : undefined}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <nav aria-label="Views" className="inline-flex rounded-lg bg-muted p-0.5 text-sm">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => show(v.id)}
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
          <SyncStatus />
        </div>
        {canWrite && board.board.available && board.repos.length > 0 && <NewTaskButton />}
      </div>
      {!board.board.available && <p className="mb-4 text-sm text-destructive">The GitHub board is not reachable right now.</p>}
      {view === "list" && <ListView />}
      {view === "board" && <KanbanView />}
      {view === "timeline" && <TimelineView />}
      <PeekPanel />
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 flex justify-center">
        {notice && <p className="pointer-events-auto rounded-lg bg-foreground px-3 py-2 text-sm text-background shadow-lg">{notice}</p>}
      </div>
    </div>
  );
}

function SyncStatus() {
  const sync = useSyncState();
  if (!sync.error) return null;
  return (
    <span className="text-xs text-amber-600" title={sync.error} data-testid="sync-error">
      Not synced — retrying
    </span>
  );
}
