"use client";
/**
 * The list view (roadmap D2, B6): one dense line per task, grouped by status like Linear, and
 * virtualized — only rows near the viewport are in the DOM, so 2,000 tasks cost what 60 do.
 */
import type { FieldView, TaskView } from "@gitwork/server";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useBoard, useBoardApi, useSnapshot } from "../board-context";
import { optionOf, treeOrder } from "./fields";
import { Avatars, DueDate, Labels, PriorityIcon, StatusIcon } from "./task-bits";
import { Ref, TaskLink, useOrder, useTaskFocus } from "./task-views";

const ROW = 40;
const HEADER = 36;
const OVERSCAN = 800;

type Item = { kind: "header"; key: string; name: string; count: number; top: number } | { kind: "row"; task: TaskView; depth: number; top: number };

/** The list's scroll position relative to the viewport, in 100 px steps (an external store). */
class Viewport {
  private el: HTMLElement | null = null;
  private snap = "0:10";
  private listeners = new Set<() => void>();
  attach = (el: HTMLElement | null) => {
    this.el = el;
    this.update();
  };
  subscribe = (listener: () => void) => {
    if (this.listeners.size === 0) {
      window.addEventListener("scroll", this.update, { passive: true });
      window.addEventListener("resize", this.update);
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        window.removeEventListener("scroll", this.update);
        window.removeEventListener("resize", this.update);
      }
    };
  };
  update = () => {
    if (!this.el) return;
    const top = this.el.getBoundingClientRect().top;
    const next = `${Math.floor(-top / 100)}:${Math.ceil(window.innerHeight / 100)}`;
    if (next === this.snap) return;
    this.snap = next;
    for (const l of this.listeners) l();
  };
  getSnapshot = () => this.snap;
  /** Scrolls the window so a list offset is in view. */
  reveal(offset: number, height: number) {
    if (!this.el) return;
    const top = this.el.getBoundingClientRect().top + offset;
    if (top < 80) window.scrollBy({ top: top - 80 });
    else if (top + height > window.innerHeight - 24) window.scrollBy({ top: top + height - window.innerHeight + 24 });
  }
}

const SERVER_SNAPSHOT = () => "0:10";

/** Groups by the status field, in the field's option order; tree order inside each group. */
function buildItems(tasks: TaskView[], status: FieldView | undefined): { items: Item[]; height: number } {
  const groups = status
    ? [...(status.options ?? []).map((o) => ({ key: o.id, name: o.name })), { key: "", name: `No ${status.name}` }].map((g) => ({
        ...g,
        tasks: tasks.filter((t) => (optionOf(t, status.id) ?? "") === g.key),
      }))
    : [{ key: "all", name: "", tasks }];
  const items: Item[] = [];
  let top = 0;
  for (const g of groups) {
    if (g.tasks.length === 0) continue;
    if (status) {
      items.push({ kind: "header", key: g.key || "none", name: g.name, count: g.tasks.length, top });
      top += HEADER;
    }
    for (const { task, depth } of treeOrder(g.tasks)) {
      items.push({ kind: "row", task, depth, top });
      top += ROW;
    }
  }
  return { items, height: top };
}

export function ListView() {
  const { tasks, fields, mapping } = useBoard();
  const { canWrite } = useSnapshot();
  const { focus } = useBoardApi();
  const status = fields.find((f) => f.id === mapping.kanbanFieldId);
  const priority = fields.find((f) => f.dataType === "SINGLE_SELECT" && /^priority$/i.test(f.name));
  // Methods, not the instance: the React Compiler treats an object passed as `ref` as a ref.
  const [{ attach, subscribe, getSnapshot, reveal }] = useState(() => {
    const v = new Viewport();
    return { attach: v.attach, subscribe: v.subscribe, getSnapshot: v.getSnapshot, reveal: (offset: number, h: number) => v.reveal(offset, h) };
  });
  const [now] = useState(() => Date.now());
  const { items, height } = useMemo(() => buildItems(tasks, status), [tasks, status]);
  const rows = useMemo(() => items.flatMap((i) => (i.kind === "row" ? [i] : [])), [items]);
  useOrder(rows.map((r) => r.task.id));

  const [scrolled, screens] = useSyncExternalStore(subscribe, getSnapshot, SERVER_SNAPSHOT).split(":").map(Number) as [number, number];
  const from = scrolled * 100 - OVERSCAN;
  const to = (scrolled + screens) * 100 + OVERSCAN;
  const visible = items.filter((i) => i.top + (i.kind === "row" ? ROW : HEADER) >= from && i.top <= to);

  // J / K can move focus to a row that is not rendered: scroll it into view.
  useEffect(
    () =>
      focus.subscribe(() => {
        const id = focus.getState().focusedId;
        const row = id ? rows.find((r) => r.task.id === id) : undefined;
        if (row) reveal(row.top, ROW);
      }),
    [focus, rows, reveal],
  );

  if (tasks.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No tasks yet.{canWrite && " Press C to create one."}
      </p>
    );
  }
  return (
    <div ref={attach} className="relative rounded-xl ring-1 ring-foreground/10" style={{ height }} data-testid="task-list">
      {visible.map((item) =>
        item.kind === "header" ? (
          <div
            key={`h:${item.key}`}
            className="absolute inset-x-0 flex items-center gap-2 border-b border-foreground/5 bg-muted/60 px-3 text-xs font-medium"
            style={{ top: item.top, height: HEADER }}
            role="heading"
            aria-level={3}
          >
            {item.name} <span className="text-muted-foreground">{item.count}</span>
          </div>
        ) : (
          <ListRow key={item.task.id} task={item.task} depth={item.depth} top={item.top} status={status} priority={priority} target={mapping.targetFieldId} now={now} />
        ),
      )}
    </div>
  );
}

function ListRow(props: { task: TaskView; depth: number; top: number; status: FieldView | undefined; priority: FieldView | undefined; target: string | null; now: number }) {
  const { task, depth } = props;
  const { focused, isSelected, toggle, attrs } = useTaskFocus(task.id);
  return (
    <div
      {...attrs}
      className={`group absolute inset-x-0 flex items-center gap-2 border-b border-foreground/5 px-3 text-sm ${focused ? "bg-muted shadow-[inset_2px_0_0_var(--color-primary)]" : isSelected ? "bg-primary/5" : "hover:bg-muted/50"}`}
      style={{ top: props.top, height: ROW }}
      data-testid="task-row"
    >
      <input
        type="checkbox"
        aria-label={`Select ${task.title}`}
        checked={isSelected}
        onChange={toggle}
        className={`size-3.5 shrink-0 ${isSelected ? "" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
      />
      {props.priority && <PriorityIcon value={task.fields[props.priority.id]} field={props.priority} />}
      <span className="w-16 shrink-0 truncate">
        <Ref task={task} />
      </span>
      <StatusIcon task={task} field={props.status} />
      <span className="flex min-w-0 flex-1 items-center gap-1" style={{ paddingLeft: depth * 16 }}>
        {depth > 0 && (
          <span aria-hidden className="text-muted-foreground">
            ↳
          </span>
        )}
        <TaskLink task={task} className="truncate font-medium hover:underline" />
        {task.state === "closed" && <span className="sr-only">Closed</span>}
      </span>
      <span className="hidden md:flex">
        <Labels task={task} />
      </span>
      <DueDate value={props.target ? task.fields[props.target] : undefined} task={task} now={props.now} />
      <Avatars task={task} />
    </div>
  );
}
