import type { TaskView } from "@gitwork/server";
import { describe, expect, it, vi } from "vitest";
import { BoardStore, type Snapshot, startPolling } from "./board-store";

const task = (id: string, title: string): TaskView => ({
  id,
  kind: "issue",
  title,
  state: "open",
  stateReason: null,
  number: 1,
  repo: { nodeId: "R", fullName: "acme/site" },
  url: null,
  labels: [],
  assignees: [],
  fields: {},
  parentId: null,
  blockedBy: [],
  updatedAt: "2026-11-10T00:00:00.000Z",
});

const snap = (...tasks: TaskView[]): Snapshot => ({
  role: "member",
  canWrite: true,
  viewer: { githubLinked: false },
  board: {
    linked: true,
    board: { title: "B", url: "", available: true },
    repos: [],
    fields: [],
    mapping: { kanbanFieldId: null, startFieldId: null, targetFieldId: null, iterationFieldId: null },
    tasks,
    lastRepoNodeId: null,
  },
});

const titles = (s: Snapshot) => (s.board.linked ? s.board.tasks.map((t) => t.title) : []);

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("BoardStore", () => {
  it("shows an edit at once, then keeps the server's version", async () => {
    const store = new BoardStore(snap(task("a", "Old")), '"e1"', { fetchSnapshot: async () => null });
    const server = deferred<TaskView>();
    const done = store.mutate("a", (t) => ({ ...t, title: "New" }), () => server.promise);
    expect(titles(store.getSnapshot())).toEqual(["New"]);
    server.resolve(task("a", "New (server)"));
    await done;
    expect(titles(store.getSnapshot())).toEqual(["New (server)"]);
  });

  it("rolls back a failed edit and rethrows", async () => {
    const store = new BoardStore(snap(task("a", "Old")), null, { fetchSnapshot: async () => null });
    await expect(store.mutate("a", (t) => ({ ...t, title: "New" }), async () => Promise.reject(new Error("GitHub refused")))).rejects.toThrow(
      "GitHub refused",
    );
    expect(titles(store.getSnapshot())).toEqual(["Old"]);
  });

  it("keeps a pending edit on top of a snapshot that arrives meanwhile", async () => {
    const fetchSnapshot = vi.fn(async () => ({ snapshot: snap(task("a", "Old"), task("b", "Other")), etag: '"e2"' }));
    const store = new BoardStore(snap(task("a", "Old")), '"e1"', { fetchSnapshot });
    const server = deferred<TaskView>();
    const done = store.mutate("a", (t) => ({ ...t, title: "New" }), () => server.promise);
    await store.poll();
    expect(titles(store.getSnapshot())).toEqual(["New", "Other"]);
    server.resolve(task("a", "New"));
    await done;
    expect(titles(store.getSnapshot())).toEqual(["New", "Other"]);
  });

  it("discards a poll that started before an edit finished, and fetches fresh next time", async () => {
    const stale = deferred<{ snapshot: Snapshot; etag: string }>();
    const fetchSnapshot = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ snapshot: snap(task("a", "New")), etag: '"e3"' });
    const store = new BoardStore(snap(task("a", "Old")), '"e1"', { fetchSnapshot });
    const poll = store.poll();
    await store.mutate("a", (t) => ({ ...t, title: "New" }), async () => task("a", "New"));
    stale.resolve({ snapshot: snap(task("a", "Old")), etag: '"e2"' });
    await poll;
    expect(titles(store.getSnapshot())).toEqual(["New"]); // no flicker back to "Old"
    await store.poll();
    expect(fetchSnapshot).toHaveBeenLastCalledWith(null); // the ETag was dropped
  });

  it("sends the ETag and keeps the snapshot on 304", async () => {
    const fetchSnapshot = vi.fn(async () => null);
    const initial = snap(task("a", "Old"));
    const store = new BoardStore(initial, '"e1"', { fetchSnapshot });
    await store.poll();
    expect(fetchSnapshot).toHaveBeenCalledWith('"e1"');
    expect(store.getSnapshot()).toBe(initial);
  });

  it("drops tasks the new snapshot no longer has (a task hidden from this viewer)", async () => {
    const store = new BoardStore(snap(task("a", "A"), task("b", "B")), '"e1"', {
      fetchSnapshot: async () => ({ snapshot: snap(task("a", "A")), etag: '"e2"' }),
    });
    await store.poll();
    expect(titles(store.getSnapshot())).toEqual(["A"]);
  });

  it("shares one request between concurrent polls and reports errors", async () => {
    const fetchSnapshot = vi.fn(async () => {
      throw new Error("offline");
    });
    const store = new BoardStore(snap(), null, { fetchSnapshot });
    await Promise.all([store.poll(), store.poll()]);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(store.getSyncState().error).toBe("offline");
  });

  it("returns a stable snapshot between changes", () => {
    const store = new BoardStore(snap(task("a", "A")), null, { fetchSnapshot: async () => null });
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it("undoes the newest edit", async () => {
    const store = new BoardStore(snap(task("a", "Old")), null, { fetchSnapshot: async () => null });
    const run = vi.fn(async () => undefined);
    await store.mutate("a", (t) => ({ ...t, title: "New" }), async () => task("a", "New"), { label: "Rename", run });
    expect(store.canUndo()).toBe(true);
    expect(await store.undo()).toBe("Rename");
    expect(run).toHaveBeenCalledOnce();
    expect(await store.undo()).toBeNull();
  });
});

describe("startPolling", () => {
  it("polls only while visible, and at once on focus", () => {
    vi.useFakeTimers();
    const store = { poll: vi.fn(async () => undefined) } as unknown as BoardStore;
    const handlers: Record<string, () => void> = {};
    const doc = { visibilityState: "hidden" as DocumentVisibilityState, addEventListener: (e: string, h: () => void) => (handlers[e] = h), removeEventListener: vi.fn() };
    const win = { addEventListener: (e: string, h: () => void) => (handlers[e] = h), removeEventListener: vi.fn() };
    const stop = startPolling(store, doc as never, win as never, 5_000);
    vi.advanceTimersByTime(5_000);
    expect(store.poll).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    vi.advanceTimersByTime(5_000);
    expect(store.poll).toHaveBeenCalledTimes(1);
    handlers.focus!();
    expect(store.poll).toHaveBeenCalledTimes(2);
    stop();
    vi.useRealTimers();
  });
});
