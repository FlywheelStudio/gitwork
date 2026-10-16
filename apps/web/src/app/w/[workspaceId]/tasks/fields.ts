import type { ProjectFieldValue } from "@gitwork/db";
import type { FieldView, TaskView } from "@gitwork/server";

/** A field value as plain text, e.g. for a table cell. */
export function fieldText(value: ProjectFieldValue | undefined): string {
  if (!value) return "";
  switch (value.type) {
    case "single_select":
      return value.name;
    case "date":
      return value.date;
    case "text":
      return value.text;
    case "number":
      return String(value.number);
    case "iteration":
      return value.title;
  }
}

export function optionOf(task: TaskView, fieldId: string | null): string | null {
  const v = fieldId ? task.fields[fieldId] : undefined;
  return v?.type === "single_select" ? v.optionId : null;
}

const DAY = 86_400_000;

/** A task's span on the timeline: start/target dates first, else its iteration. */
export function spanOf(
  task: TaskView,
  mapping: { startFieldId: string | null; targetFieldId: string | null; iterationFieldId: string | null },
): { start: number; end: number } | null {
  const date = (id: string | null) => {
    const v = id ? task.fields[id] : undefined;
    return v?.type === "date" ? Date.parse(`${v.date}T00:00:00Z`) : null;
  };
  const start = date(mapping.startFieldId);
  const end = date(mapping.targetFieldId);
  if (start !== null || end !== null) {
    const s = start ?? end!;
    const e = end ?? start!;
    return { start: Math.min(s, e), end: Math.max(s, e) + DAY };
  }
  const it = mapping.iterationFieldId ? task.fields[mapping.iterationFieldId] : undefined;
  if (it?.type === "iteration") {
    const s = Date.parse(`${it.startDate}T00:00:00Z`);
    return { start: s, end: s + it.duration * DAY };
  }
  return null;
}

/** Tasks in tree order: each parent followed by its children, with depth. */
export function treeOrder(tasks: TaskView[]): { task: TaskView; depth: number }[] {
  const children = new Map<string, TaskView[]>();
  for (const t of tasks) if (t.parentId) children.set(t.parentId, [...(children.get(t.parentId) ?? []), t]);
  const out: { task: TaskView; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (t: TaskView, depth: number) => {
    if (seen.has(t.id)) return; // a cycle in GitHub data must not hang the page
    seen.add(t.id);
    out.push({ task: t, depth });
    for (const c of children.get(t.id) ?? []) walk(c, depth + 1);
  };
  for (const t of tasks) if (!t.parentId) walk(t, 0);
  for (const t of tasks) walk(t, 0); // anything left (cycles)
  return out;
}

export function editableFields(fields: FieldView[]) {
  return fields.filter((f) => ["SINGLE_SELECT", "DATE", "TEXT", "NUMBER", "ITERATION"].includes(f.dataType));
}
