"use client";
import type { CommandId } from "@gitwork/core";
import type { FieldView, TaskDetail, TaskView } from "@gitwork/server";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api as apiCall } from "@/lib/api";
import { FocusStore } from "@/lib/focus-store";
import { BoardStore, type LinkedBoard, type Snapshot, startPolling } from "@/lib/board-store";
import { type FieldInput, currentInput, withField } from "@/lib/field-values";
import { VIEWS, type ViewId } from "./views";

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

/** Stable for the life of the workspace: rows read only this, so state changes skip them. */
interface BoardApi {
  workspaceId: string;
  store: BoardStore;
  focus: FocusStore;
  openPeek: (taskId: string) => void;
  closePeek: () => void;
  /** The task with its body. Cached per version, so hovering prefetches. */
  loadDetail: (task: TaskView) => Promise<TaskDetail>;
  notify: (message: string) => void;
  /** The task ids in on-screen order. The visible view sets it after each render. */
  setOrder: (ids: string[]) => void;
  getOrder: () => string[];
  setNewTaskOpen: (open: boolean) => void;
  setView: (view: ViewId) => void;
  /** Runs a keymap command by id, as if its keys were pressed (sidebar buttons use it). */
  runCommand: (id: CommandId) => void;
  /** The command layer registers its handlers here. */
  setCommandHandlers: (handlers: Partial<Record<CommandId, () => void>>) => void;
}

/** Changes now and then: the panel, notices, the view. */
interface BoardState {
  /** The task open in the side panel. */
  peekId: string | null;
  notice: string | null;
  newTaskOpen: boolean;
  /** The task view. Kept across pages; on the tasks page it also lives in the URL (?view=). */
  view: ViewId;
  /** True on the tasks page itself (not members, settings, or a task page). */
  onTasksPage: boolean;
}

const ApiContext = createContext<BoardApi | null>(null);
const StateContext = createContext<BoardState | null>(null);

export function BoardProvider({ workspaceId, initial, etag, children }: { workspaceId: string; initial: Snapshot; etag: string; children: ReactNode }) {
  const [store] = useState(() => new BoardStore(initial, etag, { fetchSnapshot: (e) => fetchSnapshot(workspaceId, e) }));
  const [focus] = useState(() => new FocusStore());
  const [peekId, setPeekId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const order = useRef<string[]>([]);
  const commandHandlers = useRef<Partial<Record<CommandId, () => void>>>({});
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const base = `/w/${workspaceId}`;
  const onTasksPage = pathname === base;
  const [view, setViewState] = useState<ViewId>(() => VIEWS.find((v) => v.id === params.get("view"))?.id ?? "list");
  const details = useRef(new Map<string, Promise<TaskDetail>>());
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => startPolling(store, document, window), [store]);

  const api = useMemo<BoardApi>(
    () => ({
      workspaceId,
      store,
      focus,
      openPeek: setPeekId,
      closePeek: () => setPeekId(null),
      loadDetail: (task: TaskView) => {
        const key = `${task.id}@${task.updatedAt}`;
        let found = details.current.get(key);
        if (!found) {
          found = apiCall<{ task: TaskDetail }>("GET", `/workspaces/${workspaceId}/tasks/${encodeURIComponent(task.id)}`).then((r) => r.task);
          found.catch(() => details.current.delete(key));
          details.current.set(key, found);
        }
        return found;
      },
      notify: (message: string) => {
        setNotice(message);
        clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 5_000);
      },
      setOrder: (ids: string[]) => {
        order.current = ids;
      },
      getOrder: () => order.current,
      setNewTaskOpen,
      setView: (next: ViewId) => {
        setViewState(next);
        if (window.location.pathname !== base) {
          router.push(`${base}?view=${next}`);
          return;
        }
        // On the tasks page: no server render, only the URL.
        const url = new URL(window.location.href);
        url.searchParams.set("view", next);
        window.history.replaceState(window.history.state, "", url);
      },
      runCommand: (id: CommandId) => commandHandlers.current[id]?.(),
      setCommandHandlers: (handlers: Partial<Record<CommandId, () => void>>) => {
        commandHandlers.current = handlers;
      },
    }),
    [workspaceId, store, focus, base, router],
  );
  const state = useMemo<BoardState>(() => ({ peekId, notice, newTaskOpen, view, onTasksPage }), [peekId, notice, newTaskOpen, view, onTasksPage]);

  return (
    <ApiContext value={api}>
      <StateContext value={state}>{children}</StateContext>
    </ApiContext>
  );
}

/** The stable part. Rows and links use only this. */
export function useBoardApi(): BoardApi {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useBoardApi outside BoardProvider");
  return ctx;
}

/** This row's focus and selection; re-renders only when they change. */
export function useRowFocus(id: string) {
  const { focus } = useBoardApi();
  const focused = useSyncExternalStore(focus.subscribe, () => focus.isFocused(id), () => false);
  const isSelected = useSyncExternalStore(focus.subscribe, () => focus.isSelected(id), () => false);
  return { focused, isSelected };
}

/** The panel, notices, and view, without subscribing to focus. */
export function useBoardState() {
  return { ...useBoardApi(), ...useContext(StateContext)! };
}

/** Everything, for the few components that need it (panel, command layer, sidebar). */
export function useBoardContext() {
  const api = useBoardApi();
  const state = useContext(StateContext)!;
  const { focusedId, selected } = useSyncExternalStore(api.focus.subscribe, api.focus.getState, api.focus.getState);
  return { ...api, ...state, focusedId, selected, setFocusedId: api.focus.setFocused, setSelected: api.focus.setSelected };
}

export function useSnapshot(): Snapshot {
  const { store } = useBoardApi();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

const EMPTY_BOARD: LinkedBoard = {
  linked: true,
  board: { title: "", url: "", available: false },
  repos: [],
  fields: [],
  mapping: { kanbanFieldId: null, startFieldId: null, targetFieldId: null, iterationFieldId: null },
  tasks: [],
  lastRepoNodeId: null,
};

/** The linked board; an empty one for an unlinked workspace, so global keys still work there. */
export function useBoard(): LinkedBoard {
  const snapshot = useSnapshot();
  return snapshot.board.linked ? snapshot.board : EMPTY_BOARD;
}

export function useLinked(): boolean {
  return useSnapshot().board.linked;
}

export function useSyncState() {
  const { store } = useBoardApi();
  return useSyncExternalStore(store.subscribe, store.getSyncState, store.getSyncState);
}

/** Task edits: optimistic, rolled back with a notice on failure, undoable. */
export function useTaskActions() {
  const { workspaceId, store, notify } = useBoardApi();
  return useMemo(() => taskActions(workspaceId, store, notify), [workspaceId, store, notify]);
}

function taskActions(workspaceId: string, store: BoardStore, notify: (message: string) => void) {
  const patch = (taskId: string, body: Record<string, unknown>) =>
    apiCall<{ task: TaskView }>("PATCH", `/workspaces/${workspaceId}/tasks/${encodeURIComponent(taskId)}`, body).then((r) => r.task);

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

  /** One field on many tasks, one after another (GitHub rate limits). One undo step for all. */
  async function setFieldMany(tasks: TaskView[], field: FieldView, input: FieldInput | null): Promise<void> {
    if (tasks.length === 1) return setField(tasks[0]!, field, input);
    const done: { task: TaskView; previous: FieldInput | null }[] = [];
    for (const [i, task] of tasks.entries()) {
      notify(`Updating ${field.name}: ${i + 1} of ${tasks.length}…`);
      const previous = currentInput(field, task);
      try {
        await store.mutate(task.id, withField(field, input), () => patch(task.id, { fields: { [field.id]: input } }));
        done.push({ task, previous });
      } catch (error) {
        notify(`Stopped after ${done.length} of ${tasks.length}: ${(error as Error).message}`);
        break;
      }
    }
    if (done.length === tasks.length) notify(`Updated ${field.name} on ${tasks.length} tasks.`);
    if (done.length > 0) {
      store.pushUndo({
        label: `${field.name} change on ${done.length} tasks`,
        run: async () => {
          for (const { task, previous } of done) await setField(task, field, previous, false);
        },
      });
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

  return { setField, setFieldMany, setState, undo, upsert: (task: TaskView) => store.upsert(task) };
}
