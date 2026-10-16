"use client";
import type { FieldMapping, FieldView, TaskView } from "@gitwork/server";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorText } from "@/components/kit";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { fieldText, optionOf, spanOf, treeOrder } from "./fields";

interface ViewProps {
  workspaceId: string;
  tasks: TaskView[];
  fields: FieldView[];
  mapping: FieldMapping;
  canWrite: boolean;
}

function TaskLink({ workspaceId, task }: { workspaceId: string; task: TaskView }) {
  return (
    <Link href={`/w/${workspaceId}/tasks/${encodeURIComponent(task.id)}`} className="font-medium hover:underline">
      {task.title || "(untitled)"}
    </Link>
  );
}

function Ref({ task }: { task: TaskView }) {
  if (task.kind === "draft") return <Badge variant="outline">Draft</Badge>;
  return (
    <span className="text-xs text-muted-foreground">
      {task.repo?.fullName.split("/")[1]}#{task.number}
    </span>
  );
}

function StateBadge({ task }: { task: TaskView }) {
  if (task.state !== "closed") return null;
  return <Badge variant="secondary">{task.stateReason === "not_planned" ? "Not planned" : "Closed"}</Badge>;
}

// ---- List -------------------------------------------------------------------------------------

export function ListView({ workspaceId, tasks, mapping }: ViewProps) {
  if (tasks.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Task</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Assignees</th>
            <th className="px-3 py-2 font-medium">Target</th>
          </tr>
        </thead>
        <tbody>
          {treeOrder(tasks).map(({ task, depth }) => (
            <tr key={task.id} className="border-t border-foreground/5" data-testid="task-row">
              <td className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2" style={{ paddingLeft: depth * 20 }}>
                  {depth > 0 && <span className="text-muted-foreground">↳</span>}
                  <TaskLink workspaceId={workspaceId} task={task} />
                  <Ref task={task} />
                  <StateBadge task={task} />
                  {task.labels.map((l) => (
                    <Badge key={l.name} variant="outline">
                      {l.name}
                    </Badge>
                  ))}
                </div>
              </td>
              <td className="px-3 py-2">{fieldText(mapping.kanbanFieldId ? task.fields[mapping.kanbanFieldId] : undefined)}</td>
              <td className="px-3 py-2 text-muted-foreground">{task.assignees.map((a) => a.login).join(", ")}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {fieldText(mapping.targetFieldId ? task.fields[mapping.targetFieldId] : undefined)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Kanban -----------------------------------------------------------------------------------

export function KanbanView({ workspaceId, tasks, fields, mapping, canWrite }: ViewProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState(mapping.kanbanFieldId);
  const singleSelects = fields.filter((f) => f.dataType === "SINGLE_SELECT");
  const field = singleSelects.find((f) => f.id === groupBy);
  if (!field) return <p className="text-sm text-muted-foreground">This board has no single-select field to group by.</p>;
  const columns = [...(field.options ?? []).map((o) => ({ id: o.id as string | null, name: o.name })), { id: null, name: `No ${field.name}` }];

  async function move(taskId: string, optionId: string | null) {
    setError("");
    try {
      await api("PATCH", `/workspaces/${workspaceId}/tasks/${encodeURIComponent(taskId)}`, {
        fields: { [field!.id]: optionId ? { type: "single_select", optionId } : null },
      });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      {singleSelects.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          Group by
          <select className="h-8 rounded-lg border border-input bg-transparent px-2" value={field.id} onChange={(e) => setGroupBy(e.target.value)}>
            {singleSelects.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const cards = tasks.filter((t) => optionOf(t, field.id) === col.id);
          return (
            <section
              key={col.id ?? "none"}
              aria-label={col.name}
              className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/50 p-2"
              onDragOver={(e) => canWrite && dragging && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain");
                setDragging(null);
                const task = tasks.find((t) => t.id === id);
                if (task && optionOf(task, field.id) !== col.id) void move(id, col.id);
              }}
            >
              <h3 className="flex items-center justify-between px-1 text-sm font-medium">
                {col.name} <span className="text-xs text-muted-foreground">{cards.length}</span>
              </h3>
              {cards.map((task) => (
                <article
                  key={task.id}
                  draggable={canWrite}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", task.id);
                    setDragging(task.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className="space-y-1 rounded-lg bg-card p-2 text-sm shadow-xs ring-1 ring-foreground/10"
                  data-testid="task-card"
                >
                  <TaskLink workspaceId={workspaceId} task={task} />
                  <div className="flex flex-wrap items-center gap-1">
                    <Ref task={task} />
                    <StateBadge task={task} />
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---- Timeline ---------------------------------------------------------------------------------

const DAY = 86_400_000;
const ROW = 36;
const DAY_PX = 24;
const BAR = 20;

export function TimelineView({ workspaceId, tasks, mapping }: ViewProps) {
  // Read the clock once per mount, not on every render.
  const [now] = useState(() => Date.now());
  if (!mapping.startFieldId && !mapping.targetFieldId && !mapping.iterationFieldId) {
    return <p className="text-sm text-muted-foreground">This board has no date or iteration fields. An Admin can map them in Settings.</p>;
  }
  const scheduled = treeOrder(tasks).flatMap(({ task }) => {
    const span = spanOf(task, mapping);
    return span ? [{ task, ...span }] : [];
  });
  const unscheduled = tasks.filter((t) => !spanOf(t, mapping));
  // Two days of air on each side, starting on a Monday so week lines fall on whole days.
  const first = scheduled.length ? Math.min(...scheduled.map((s) => s.start)) - 2 * DAY : now;
  const startDay = first - ((new Date(first).getUTCDay() + 6) % 7) * DAY;
  const endDay = scheduled.length ? Math.max(...scheduled.map((s) => s.end)) + 2 * DAY : startDay + 14 * DAY;
  const days = Math.max(14, Math.ceil((endDay - startDay) / DAY));
  const x = (t: number) => ((t - startDay) / DAY) * DAY_PX;
  const width = days * DAY_PX;
  const height = scheduled.length * ROW;
  const rowOf = new Map(scheduled.map((s, i) => [s.task.id, i]));
  const weeks = Array.from({ length: Math.ceil(days / 7) }, (_, i) => startDay + i * 7 * DAY);
  const label = (t: number) => new Date(t).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div className="space-y-6">
      {scheduled.length === 0 ? (
        <p className="text-sm text-muted-foreground">No task has dates yet.</p>
      ) : (
        <div className="grid grid-cols-[minmax(10rem,16rem)_1fr] rounded-xl ring-1 ring-foreground/10">
          <div className="border-r border-foreground/10">
            <div className="h-8 border-b border-foreground/10" />
            {scheduled.map(({ task }) => (
              <div key={task.id} className="flex items-center truncate px-3 text-sm" style={{ height: ROW }} data-testid="timeline-row">
                <TaskLink workspaceId={workspaceId} task={task} />
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <div style={{ width }}>
              <div className="relative h-8 border-b border-foreground/10 text-xs text-muted-foreground">
                {weeks.map((w) => (
                  <span key={w} className="absolute top-2 pl-1 whitespace-nowrap" style={{ left: x(w) }}>
                    {label(w)}
                  </span>
                ))}
              </div>
              <svg width={width} height={height} className="block" aria-hidden>
                <defs>
                  <marker id="arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0,0 L6,3 L0,6 z" className="fill-muted-foreground" />
                  </marker>
                </defs>
                {weeks.map((w) => (
                  <line key={w} x1={x(w)} x2={x(w)} y1={0} y2={height} className="stroke-foreground/10" />
                ))}
                {now > startDay && now < startDay + days * DAY && (
                  <line x1={x(now)} x2={x(now)} y1={0} y2={height} className="stroke-destructive/60" strokeDasharray="3 3" />
                )}
                {scheduled.map(({ task, start, end }, i) => (
                  <rect key={task.id} x={x(start)} y={i * ROW + (ROW - BAR) / 2} width={Math.max(x(end) - x(start), 6)} height={BAR} rx={5} className="fill-primary/80">
                    <title>{task.title}</title>
                  </rect>
                ))}
                {/* Dependencies: out of the blocker's end, down, into the blocked task's start. */}
                {scheduled.flatMap(({ task, start }, i) =>
                  task.blockedBy.flatMap((blocker) => {
                    const j = rowOf.get(blocker);
                    if (j === undefined) return [];
                    const x1 = x(scheduled[j]!.end);
                    const y1 = j * ROW + ROW / 2;
                    const x2 = x(start);
                    const y2 = i * ROW + ROW / 2;
                    const elbow = x1 + 8;
                    const d = elbow <= x2 - 8
                      ? `M${x1},${y1} H${elbow} V${y2} H${x2}`
                      : // The blocked task starts before its blocker ends: loop back between rows.
                        `M${x1},${y1} H${elbow} V${(y1 + y2) / 2} H${x2 - 8} V${y2} H${x2}`;
                    return [<path key={`${blocker}-${task.id}`} d={d} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} markerEnd="url(#arrow)" />];
                  }),
                )}
              </svg>
            </div>
          </div>
        </div>
      )}
      {unscheduled.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">Unscheduled</h3>
          <ul className="space-y-1 text-sm">
            {unscheduled.map((task) => (
              <li key={task.id} className="flex items-center gap-2">
                <TaskLink workspaceId={workspaceId} task={task} /> <Ref task={task} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-muted-foreground">No tasks yet.</p>;
}
