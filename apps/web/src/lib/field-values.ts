/**
 * Board field values: the API's input shape, form strings, and the cached value shape. Pure, so
 * optimistic edits produce exactly what the server will store.
 */
import type { ProjectFieldValue } from "@gitwork/db";
import type { FieldView, TaskView } from "@gitwork/server";

export type FieldInput =
  | { type: "single_select"; optionId: string }
  | { type: "date"; date: string }
  | { type: "text"; text: string }
  | { type: "number"; number: number }
  | { type: "iteration"; iterationId: string };

/** The form's string value for a field. */
export function toInputValue(v: ProjectFieldValue | undefined): string {
  if (!v) return "";
  switch (v.type) {
    case "single_select":
      return v.optionId;
    case "iteration":
      return v.iterationId;
    case "date":
      return v.date;
    case "text":
      return v.text;
    case "number":
      return String(v.number);
  }
}

/** A form string as the API's input; "" clears the field. */
export function fromInputValue(field: FieldView, value: string): FieldInput | null {
  if (value === "") return null;
  switch (field.dataType) {
    case "SINGLE_SELECT":
      return { type: "single_select", optionId: value };
    case "ITERATION":
      return { type: "iteration", iterationId: value };
    case "DATE":
      return { type: "date", date: value };
    case "NUMBER":
      return { type: "number", number: Number(value) };
    default:
      return { type: "text", text: value };
  }
}

/** The cached value an input produces, or null if the option or iteration is unknown. */
export function valueOf(field: FieldView, input: FieldInput): ProjectFieldValue | null {
  switch (input.type) {
    case "single_select": {
      const o = field.options?.find((x) => x.id === input.optionId);
      return o ? { type: "single_select", optionId: o.id, name: o.name } : null;
    }
    case "iteration": {
      const it = field.iterations?.find((x) => x.id === input.iterationId);
      return it ? { type: "iteration", iterationId: it.id, title: it.title, startDate: it.startDate, duration: it.duration } : null;
    }
    case "date":
      return { type: "date", date: input.date };
    case "text":
      return { type: "text", text: input.text };
    case "number":
      return { type: "number", number: input.number };
  }
}

/** A patch that sets (or, with null, clears) one field on a task. */
export function withField(field: FieldView, input: FieldInput | null) {
  return (task: TaskView): TaskView => {
    const fields = { ...task.fields };
    const value = input ? valueOf(field, input) : null;
    if (value) fields[field.id] = value;
    else delete fields[field.id];
    return { ...task, fields };
  };
}

/** The input that restores a task's current value of a field (for undo). */
export function currentInput(field: FieldView, task: TaskView): FieldInput | null {
  return fromInputValue(field, toInputValue(task.fields[field.id]));
}
