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

export function TimelineView({ workspaceId, tasks, mapping }: ViewProps) {
  const scheduled = treeOrder(tasks).flatMap(({ task }) => {
    const span = spanOf(task, mapping);
    return span ? [{ task, ...span }] : [];
  });
  const unscheduled = tasks.filter((t) => !spanOf(t, mapping));
  if (!mapping.startFieldId && !mapping.targetFieldId && !mapping.iterationFieldId) {
    return <p className="text-sm text-muted-foreground">This board has no date or iteration fields. An Admin can map them in Settings.</p>;
  }
  const min = Math.min(...scheduled.map((s) => s.start));
  const max = Math.max(...scheduled.map((s) => s.end));
  const days = scheduled.length ? Math.max(7, Math.round((max - min) / DAY)) : 7;
  const pct = (t: number) => ((t - min) / (days * DAY)) * 100;
  const rowOf = new Map(scheduled.map((s, i) => [s.task.id, i]));
  const months: { label: string; left: number }[] = [];
  if (scheduled.length) {
    const d = new Date(min);
    d.setUTCDate(1);
    for (; d.getTime() < max; d.setUTCMonth(d.getUTCMonth() + 1)) {
      if (d.getTime() >= min) months.push({ label: d.toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" }), left: pct(d.getTime()) });
    }
  }

  return (
    <div className="space-y-6">
      {scheduled.length === 0 ? (
        <p className="text-sm text-muted-foreground">No task has dates yet.</p>
      ) : (
        <div className="grid grid-cols-[minmax(10rem,16rem)_1fr] overflow-x-auto rounded-xl ring-1 ring-foreground/10">
          <div className="border-r border-foreground/10">
            <div className="h-8 border-b border-foreground/10" />
            {scheduled.map(({ task }) => (
              <div key={task.id} className="flex items-center truncate px-3 text-sm" style={{ height: ROW }} data-testid="timeline-row">
                <TaskLink workspaceId={workspaceId} task={task} />
              </div>
            ))}
          </div>
          <div className="relative min-w-[40rem]">
            <div className="relative h-8 border-b border-foreground/10 text-xs text-muted-foreground">
              {months.map((m) => (
                <span key={m.label} className="absolute top-2 pl-1" style={{ left: `${m.left}%` }}>
                  {m.label}
                </span>
              ))}
            </div>
            <div className="relative" style={{ height: scheduled.length * ROW }}>
              {scheduled.map(({ task, start, end }, i) => (
                <div
                  key={task.id}
                  title={task.title}
                  className="absolute h-5 rounded-md bg-primary/80"
                  style={{ top: i * ROW + (ROW - 20) / 2, left: `${pct(start)}%`, width: `${Math.max(pct(end) - pct(start), 0.8)}%` }}
                />
              ))}
              {/* Dependency arrows: from the blocker's end to the blocked task's start. */}
              <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
                <defs>
                  <marker id="arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0,0 L6,3 L0,6 z" className="fill-muted-foreground" />
                  </marker>
                </defs>
                {scheduled.flatMap(({ task, start }, i) =>
                  task.blockedBy.flatMap((blocker) => {
                    const j = rowOf.get(blocker);
                    if (j === undefined) return [];
                    const from = scheduled[j]!;
                    return [
                      <line
                        key={`${blocker}-${task.id}`}
                        x1={`${pct(from.end)}%`}
                        y1={j * ROW + ROW / 2}
                        x2={`${pct(start)}%`}
                        y2={i * ROW + ROW / 2}
                        className="stroke-muted-foreground"
                        strokeWidth={1.5}
                        markerEnd="url(#arrow)"
                      />,
                    ];
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
