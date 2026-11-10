"use client";
/** Small pieces of a task row or card: one look for each property, everywhere (roadmap D2). */
import type { ProjectFieldValue } from "@gitwork/db";
import type { FieldView, TaskView } from "@gitwork/server";

/** GitHub's single-select option colors. */
const OPTION_COLOR: Record<string, string> = {
  GRAY: "text-zinc-400",
  BLUE: "text-sky-500",
  GREEN: "text-emerald-500",
  YELLOW: "text-amber-500",
  ORANGE: "text-orange-500",
  RED: "text-red-500",
  PINK: "text-pink-500",
  PURPLE: "text-violet-500",
};

/** The status as a colored ring; a check when the issue is closed. The name is for screen readers and search. */
export function StatusIcon({ task, field }: { task: TaskView; field: FieldView | undefined }) {
  const value = field ? task.fields[field.id] : undefined;
  const name = value?.type === "single_select" ? value.name : field ? `No ${field.name}` : "";
  const color = value?.type === "single_select" ? (OPTION_COLOR[field?.options?.find((o) => o.id === value.optionId)?.color ?? ""] ?? "text-zinc-400") : "text-zinc-300";
  const closed = task.state === "closed";
  return (
    <span className={`inline-flex shrink-0 items-center ${closed ? "text-violet-500" : color}`} title={closed ? `${name} · closed` : name}>
      <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden>
        {closed ? (
          <>
            <circle cx="7" cy="7" r="6" className="fill-current" />
            <path d="M4.2 7.2l1.9 1.9 3.8-4" className="stroke-background" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <circle cx="7" cy="7" r="5.5" className="stroke-current" strokeWidth="1.8" fill="none" />
        )}
      </svg>
      <span className="sr-only">{name}</span>
    </span>
  );
}

/** Bars by rank: the first option of the Priority field is the highest. */
export function PriorityIcon({ value, field }: { value: ProjectFieldValue | undefined; field: FieldView }) {
  if (value?.type !== "single_select") return <span className="w-3.5 shrink-0" aria-hidden />;
  const options = field.options ?? [];
  const rank = options.findIndex((o) => o.id === value.optionId);
  const filled = rank === -1 ? 0 : Math.max(1, 3 - Math.floor((rank * 3) / Math.max(options.length, 1)));
  return (
    <span className="inline-flex shrink-0 items-end gap-px text-muted-foreground" title={`Priority: ${value.name}`}>
      {[1, 2, 3].map((bar) => (
        <span key={bar} aria-hidden className={`w-[3px] rounded-sm ${bar <= filled ? "bg-current" : "bg-current/25"}`} style={{ height: 4 + bar * 3 }} />
      ))}
      <span className="sr-only">Priority {value.name}</span>
    </span>
  );
}

export function Labels({ task, max = 2 }: { task: TaskView; max?: number }) {
  if (task.labels.length === 0) return null;
  const shown = task.labels.slice(0, max);
  const rest = task.labels.length - shown.length;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {shown.map((l) => (
        <span key={l.name} className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 text-xs text-muted-foreground">
          <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: `#${l.color}` }} />
          {l.name}
        </span>
      ))}
      {rest > 0 && <span className="text-xs text-muted-foreground" title={task.labels.slice(max).map((l) => l.name).join(", ")}>+{rest}</span>}
    </span>
  );
}

export function Avatars({ task }: { task: TaskView }) {
  if (task.assignees.length === 0) return <span className="w-5 shrink-0" aria-hidden />;
  return (
    <span className="flex shrink-0 -space-x-1.5" title={task.assignees.map((a) => a.login).join(", ")}>
      {task.assignees.slice(0, 3).map((a) => (
        // eslint-disable-next-line @next/next/no-img-element -- GitHub avatars: tiny, already sized by GitHub
        <img key={a.login} src={`${a.avatarUrl}${a.avatarUrl.includes("?") ? "&" : "?"}s=40`} alt={a.login} loading="lazy" className="size-5 rounded-full ring-2 ring-background" />
      ))}
    </span>
  );
}

const SHORT = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Dec 24"; red when past and the task is open. The ISO date is in the title. */
export function DueDate({ value, task, now }: { value: ProjectFieldValue | undefined; task: TaskView; now: number }) {
  if (value?.type !== "date") return null;
  const at = Date.parse(`${value.date}T00:00:00Z`);
  const overdue = task.state !== "closed" && at + 86_400_000 < now;
  return (
    <time dateTime={value.date} title={value.date} className={`shrink-0 text-xs tabular-nums ${overdue ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
      {SHORT.format(at)}
    </time>
  );
}
