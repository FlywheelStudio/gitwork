/**
 * The client-side store for one workspace's tasks (decisions 026, 033). Framework-free so it can be
 * unit-tested; React reads it through useSyncExternalStore (see board-context.tsx).
 *
 * - `base` is the last snapshot the server sent. It holds only what this viewer may see.
 * - `pending` edits are layered over `base` until the server answers, so a poll that started
 *   before an edit never shows the old value again (no flicker back).
 * - A poll whose request started before an edit finished is discarded: its snapshot may predate it.
 */
import type { BoardSnapshot, TaskView } from "@gitwork/server";

export type LinkedBoard = Extract<BoardSnapshot["board"], { linked: true }>;
export type Snapshot = BoardSnapshot;

/** Changes a task locally. Must be pure. */
export type TaskPatch = (task: TaskView) => TaskView;

interface Pending {
  id: number;
  taskId: string;
  patch: TaskPatch;
}

export interface UndoEntry {
  label: string;
  run: () => Promise<void>;
}

export type SyncState = { status: "idle" | "syncing"; lastSyncedAt: number; error: string | null };

export interface StoreDeps {
  /** GET /sync. Returns null on 304. */
  fetchSnapshot: (etag: string | null) => Promise<{ snapshot: Snapshot; etag: string } | null>;
  now?: () => number;
}

export class BoardStore {
  private base: Snapshot;
  private etag: string | null;
  private pending: Pending[] = [];
  private nextId = 1;
  /** Bumped when an edit settles. A poll started under an older value is stale. */
  private writes = 0;
  private merged: Snapshot | null = null;
  private listeners = new Set<() => void>();
  private undoStack: UndoEntry[] = [];
  private sync: SyncState;
  private inFlight: Promise<void> | null = null;

  constructor(
    initial: Snapshot,
    etag: string | null,
    private deps: StoreDeps,
  ) {
    this.base = initial;
    this.etag = etag;
    this.sync = { status: "idle", lastSyncedAt: this.now(), error: null };
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    this.merged = null;
    for (const l of this.listeners) l();
  }

  /** The snapshot with pending edits applied. Stable between changes (useSyncExternalStore). */
  getSnapshot = (): Snapshot => {
    if (this.merged) return this.merged;
    if (this.pending.length === 0 || !this.base.board.linked) return (this.merged = this.base);
    const byTask = new Map<string, TaskPatch[]>();
    for (const p of this.pending) byTask.set(p.taskId, [...(byTask.get(p.taskId) ?? []), p.patch]);
    const tasks = this.base.board.tasks.map((t) => (byTask.get(t.id) ?? []).reduce((acc, patch) => patch(acc), t));
    return (this.merged = { ...this.base, board: { ...this.base.board, tasks } });
  };

  getSyncState = () => this.sync;

  private setSync(next: Partial<SyncState>) {
    this.sync = { ...this.sync, ...next };
    this.emit();
  }

  /** Fetches a new snapshot if the server has one. Concurrent calls share one request. */
  poll(): Promise<void> {
    this.inFlight ??= this.doPoll().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doPoll() {
    const startedAt = this.writes;
    this.setSync({ status: "syncing" });
    try {
      const result = await this.deps.fetchSnapshot(this.etag);
      if (this.writes !== startedAt) {
        // An edit finished while this request ran; its answer may not include the edit.
        this.etag = null;
        this.setSync({ status: "idle", error: null });
        return;
      }
      if (result) {
        this.base = result.snapshot;
        this.etag = result.etag;
      }
      this.setSync({ status: "idle", lastSyncedAt: this.now(), error: null });
    } catch (error) {
      this.setSync({ status: "idle", error: (error as Error).message });
    }
  }

  /**
   * Applies `patch` at once, then runs `request`. On success the server's task replaces the local
   * one; on failure the patch is dropped (the edit rolls back) and the error is rethrown.
   */
  async mutate(taskId: string, patch: TaskPatch, request: () => Promise<TaskView>, undo?: UndoEntry): Promise<TaskView> {
    const entry: Pending = { id: this.nextId++, taskId, patch };
    this.pending.push(entry);
    this.emit();
    try {
      const task = await request();
      this.upsert(task);
      if (undo) this.undoStack.push(undo);
      return task;
    } finally {
      this.pending = this.pending.filter((p) => p.id !== entry.id);
      this.writes++;
      this.emit();
    }
  }

  /** Puts a task from a write response into the base snapshot (new or changed). */
  upsert(task: TaskView) {
    if (!this.base.board.linked) return;
    const tasks = this.base.board.tasks;
    const i = tasks.findIndex((t) => t.id === task.id);
    const next = i === -1 ? [...tasks, task] : tasks.map((t, j) => (j === i ? task : t));
    this.base = { ...this.base, board: { ...this.base.board, tasks: next } };
    // The ETag no longer matches what we hold; the next poll must fetch.
    this.etag = null;
    this.emit();
  }

  /** Records an undo step for work done outside `mutate` (a bulk edit is one step). */
  pushUndo(entry: UndoEntry) {
    this.undoStack.push(entry);
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  /** Undoes the newest edit. Returns its label, or null when there is nothing to undo. */
  async undo(): Promise<string | null> {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    await entry.run();
    return entry.label;
  }
}

/** Polls every `everyMs` while the page is visible, and at once when it becomes visible again. */
export function startPolling(store: BoardStore, doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">, win: Pick<Window, "addEventListener" | "removeEventListener">, everyMs = 5_000) {
  const tick = () => {
    if (doc.visibilityState === "visible") void store.poll();
  };
  const timer = setInterval(tick, everyMs);
  doc.addEventListener("visibilitychange", tick);
  win.addEventListener("focus", tick);
  return () => {
    clearInterval(timer);
    doc.removeEventListener("visibilitychange", tick);
    win.removeEventListener("focus", tick);
  };
}
