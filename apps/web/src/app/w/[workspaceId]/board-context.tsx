"use client";
import type { FieldView, TaskDetail, TaskView } from "@gitwork/server";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { BoardStore, type LinkedBoard, type Snapshot, startPolling } from "@/lib/board-store";
import { type FieldInput, currentInput, withField } from "@/lib/field-values";

async function fetchSnapshot(workspaceId: string, etag: string | null) {
  const res = await fetch(`/api/v1/workspaces/${workspaceId}/sync`, {
    headers: etag ? { "if-none-match": etag } : {},
    cache: "no-store",
  });
  if (res.status === 304) return null;
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    // Signed out or removed from the workspace: let the server decide what to show.
    window.location.reload();
    return null;
  }
  if (!res.ok) throw new Error(`Sync failed (${res.status}).`);
  return { snapshot: (await res.json()) as Snapshot, etag: res.headers.get("etag") ?? "" };
}

interface BoardContextValue {
  workspaceId: string;
  store: BoardStore;
  /** The task open in the side panel. */
  peekId: string | null;
  openPeek: (taskId: string) => void;
  closePeek: () => void;
  /** The task with its body. Cached per version, so hovering prefetches. */
  loadDetail: (task: TaskView) => Promise<TaskDetail>;
  notice: string | null;
  notify: (message: string) => void;
}

const BoardContext = createContext<BoardContextValue | null>(null);

export function BoardProvider({ workspaceId, initial, etag, children }: { workspaceId: string; initial: Snapshot; etag: string; children: ReactNode }) {
  const [store] = useState(() => new BoardStore(initial, etag, { fetchSnapshot: (e) => fetchSnapshot(workspaceId, e) }));
  const [peekId, setPeekId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const details = useRef(new Map<string, Promise<TaskDetail>>());
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => startPolling(store, document, window), [store]);

  const loadDetail = useCallback(
    (task: TaskView) => {
      const key = `${task.id}@${task.updatedAt}`;
      let found = details.current.get(key);
      if (!found) {
        found = api<{ task: TaskDetail }>("GET", `/workspaces/${workspaceId}/tasks/${encodeURIComponent(task.id)}`).then((r) => r.task);
        found.catch(() => details.current.delete(key));
        details.current.set(key, found);
      }
      return found;
    },
    [workspaceId],
  );

  const notify = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5_000);
  }, []);

  const value = useMemo<BoardContextValue>(
    () => ({ workspaceId, store, peekId, openPeek: setPeekId, closePeek: () => setPeekId(null), loadDetail, notice, notify }),
    [workspaceId, store, peekId, loadDetail, notice, notify],
  );
  return <BoardContext value={value}>{children}</BoardContext>;
}

export function useBoardContext(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error("useBoardContext outside BoardProvider");
  return ctx;
}

export function useSnapshot(): Snapshot {
  const { store } = useBoardContext();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** The linked board. Only rendered under a linked workspace. */
export function useBoard(): LinkedBoard {
  const snapshot = useSnapshot();
  if (!snapshot.board.linked) throw new Error("useBoard on an unlinked workspace");
  return snapshot.board;
}

export function useSyncState() {
  const { store } = useBoardContext();
  return useSyncExternalStore(store.subscribe, store.getSyncState, store.getSyncState);
}

/** Task edits: optimistic, rolled back with a notice on failure, undoable. */
export function useTaskActions() {
  const { workspaceId, store, notify } = useBoardContext();
  return useMemo(() => taskActions(workspaceId, store, notify), [workspaceId, store, notify]);
}

function taskActions(workspaceId: string, store: BoardStore, notify: (message: string) => void) {
  const patch = (taskId: string, body: Record<string, unknown>) =>
    api<{ task: TaskView }>("PATCH", `/workspaces/${workspaceId}/tasks/${encodeURIComponent(taskId)}`, body).then((r) => r.task);

  async function setField(task: TaskView, field: FieldView, input: FieldInput | null, undoable = true): Promise<void> {
    const previous = currentInput(field, task);
    try {
      await store.mutate(
        task.id,
        withField(field, input),
        () => patch(task.id, { fields: { [field.id]: input } }),
        undoable ? { label: `${field.name} change`, run: () => setField(task, field, previous, false) } : undefined,
      );
    } catch (error) {
      notify(`Could not change ${field.name}: ${(error as Error).message}`);
    }
  }

  async function setState(task: TaskView, state: "open" | "closed", undoable = true): Promise<void> {
    const previous = task.state === "closed" ? "closed" : "open";
    try {
      await store.mutate(
        task.id,
        (t) => ({ ...t, state, stateReason: state === "closed" ? "completed" : null }),
        () => patch(task.id, { state, stateReason: state === "closed" ? "completed" : "reopened" }),
        undoable ? { label: state === "closed" ? "Close" : "Reopen", run: () => setState(task, previous, false) } : undefined,
      );
    } catch (error) {
      notify(`Could not ${state === "closed" ? "close" : "reopen"} the task: ${(error as Error).message}`);
    }
  }

  async function undo(): Promise<void> {
    try {
      const label = await store.undo();
      notify(label ? `Undone: ${label}` : "Nothing to undo.");
    } catch (error) {
      notify(`Could not undo: ${(error as Error).message}`);
    }
  }

  return { setField, setState, undo, upsert: (task: TaskView) => store.upsert(task) };
}
