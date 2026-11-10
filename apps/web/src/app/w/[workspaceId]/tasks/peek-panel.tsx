"use client";
import type { FieldView, TaskDetail, TaskView } from "@gitwork/server";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Input, Select } from "@/components/kit";
import { Badge } from "@/components/ui/badge";
import { fromInputValue, toInputValue } from "@/lib/field-values";
import { useBoard, useBoardApi, useBoardState, useSnapshot, useTaskActions } from "../board-context";
import { editableFields } from "./fields";
import { Ref, StateBadge } from "./task-views";

/**
 * The task beside the list. Everything but the body comes from the store, so it opens in the
 * same frame as the click. Edits are optimistic (useTaskActions).
 */
export function PeekPanel() {
  const { peekId, closePeek, workspaceId } = useBoardState();
  const { tasks } = useBoard();
  const task = peekId ? tasks.find((t) => t.id === peekId) : undefined;

  // Escape closes the panel through the keymap (command-layer.tsx).
  if (!peekId) return null;
  return (
    <aside
      aria-label="Task details"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col overflow-y-auto border-l border-border bg-background shadow-xl sm:w-[28rem]"
      data-testid="peek-panel"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        {task ? <Ref task={task} /> : <span />}
        <div className="flex items-center gap-3 text-sm">
          {task && (
            <Link href={`/w/${workspaceId}/tasks/${encodeURIComponent(task.id)}`} className="text-muted-foreground hover:underline">
              Open page
            </Link>
          )}
          {task?.url && (
            <a href={task.url} className="text-muted-foreground hover:underline">
              GitHub
            </a>
          )}
          <Button variant="ghost" size="sm" onClick={closePeek} aria-label="Close panel">
            ✕
          </Button>
        </div>
      </div>
      {task ? <PeekBody key={task.id} task={task} /> : <p className="p-4 text-sm text-muted-foreground">This task is no longer on the board.</p>}
    </aside>
  );
}

function PeekBody({ task }: { task: TaskView }) {
  const { loadDetail } = useBoardApi();
  const { fields } = useBoard();
  const { canWrite } = useSnapshot();
  const { setState } = useTaskActions();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    loadDetail(task).then(
      (d) => live && setDetail(d),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [task, loadDetail]);

  return (
    <div className="space-y-5 p-4">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{task.title || "(untitled)"}</h2>
        <div className="flex flex-wrap items-center gap-1">
          <StateBadge task={task} />
          {task.labels.map((l) => (
            <Badge key={l.name} variant="outline">
              {l.name}
            </Badge>
          ))}
          {task.assignees.length > 0 && <span className="text-xs text-muted-foreground">{task.assignees.map((a) => a.login).join(", ")}</span>}
        </div>
      </div>

      <dl className="grid grid-cols-[8rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
        {editableFields(fields).map((f) => (
          <FieldRow key={f.id} field={f} task={task} canWrite={canWrite} />
        ))}
      </dl>

      {canWrite && task.kind === "issue" && (
        <Button variant="secondary" size="sm" onClick={() => void setState(task, task.state === "closed" ? "open" : "closed")}>
          {task.state === "closed" ? "Reopen task" : "Close task"}
        </Button>
      )}
      {canWrite && <WritePath />}

      <section aria-label="Description" className="border-t border-border pt-4">
        {detail ? (
          detail.body?.trim() ? (
            <p className="text-sm whitespace-pre-wrap">{detail.body}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No description.</p>
          )
        ) : failed ? (
          <p className="text-sm text-destructive">Could not load the description.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </section>
    </div>
  );
}

/**
 * Says where an edit goes before the person makes it (decisions 008, 021): their own GitHub
 * account, or the Gitwork app with their name on it.
 */
export function WritePath() {
  const { viewer } = useSnapshot();
  return viewer.githubLinked ? (
    <p className="text-xs text-muted-foreground" data-testid="write-path" title="If your GitHub account cannot write to this repo, the Gitwork app saves it and adds your name.">
      Edits save to GitHub as you.
    </p>
  ) : (
    <p className="text-xs text-muted-foreground" data-testid="write-path" title="Link GitHub in your settings to save as yourself.">
      Edits save to GitHub through the Gitwork app, signed with your name.
    </p>
  );
}

function FieldRow({ field, task, canWrite }: { field: FieldView; task: TaskView; canWrite: boolean }) {
  const { setField } = useTaskActions();
  const value = toInputValue(task.fields[field.id]);
  const id = `peek-${field.id}`;
  const [draft, setDraft] = useState(value);
  // A new value from the store (another edit, a poll) replaces an untouched draft.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  const commit = (next: string) => {
    if (next !== value) void setField(task, field, fromInputValue(field, next));
  };

  return (
    <>
      <dt>
        <label htmlFor={id} className="text-muted-foreground">
          {field.name}
        </label>
      </dt>
      <dd>
        {!canWrite ? (
          <span id={id}>{value ? displayValue(field, value) : "—"}</span>
        ) : field.dataType === "SINGLE_SELECT" || field.dataType === "ITERATION" ? (
          <Select id={id} className="w-full" value={value} onChange={(e) => commit(e.target.value)}>
            <option value="">None</option>
            {options(field).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            id={id}
            type={field.dataType === "DATE" ? "date" : field.dataType === "NUMBER" ? "number" : "text"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit(draft);
              if (e.key === "Escape") {
                e.stopPropagation(); // keep the panel open; just drop the draft
                setDraft(value);
              }
            }}
          />
        )}
      </dd>
    </>
  );
}

function options(field: FieldView) {
  return field.dataType === "SINGLE_SELECT"
    ? (field.options ?? []).map((o) => ({ id: o.id, name: o.name }))
    : (field.iterations ?? []).map((i) => ({ id: i.id, name: i.title }));
}

function displayValue(field: FieldView, value: string) {
  return options(field).find((o) => o.id === value)?.name ?? value;
}
