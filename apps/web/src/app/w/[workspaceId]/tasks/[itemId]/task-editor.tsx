"use client";
import type { FieldView, TaskDetail } from "@gitwork/server";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, ErrorText, Input, Label, Select, Textarea } from "@/components/kit";
import { api } from "@/lib/api";
import { fromInputValue, toInputValue } from "@/lib/field-values";

export function TaskEditor({ workspaceId, task, fields }: { workspaceId: string; task: TaskDetail; fields: FieldView[] }) {
  const router = useRouter();
  const initial = Object.fromEntries(fields.map((f) => [f.id, toInputValue(task.fields[f.id])]));
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body ?? "");
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isIssue = task.kind === "issue";

  async function save(extra: { state?: "open" | "closed"; stateReason?: "completed" | "not_planned" | "reopened" } = {}) {
    setBusy(true);
    setError("");
    try {
      const changed = Object.fromEntries(
        fields.filter((f) => values[f.id] !== initial[f.id]).map((f) => [f.id, fromInputValue(f, values[f.id] ?? "")]),
      );
      await api("PATCH", `/workspaces/${workspaceId}/tasks/${encodeURIComponent(task.id)}`, {
        ...(isIssue && title !== task.title ? { title } : {}),
        ...(isIssue && body !== (task.body ?? "") ? { body } : {}),
        ...(Object.keys(changed).length ? { fields: changed } : {}),
        ...extra,
      });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6 space-y-4">
      <h3 className="font-medium">Edit</h3>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {isIssue && (
          <>
            <div>
              <Label htmlFor="edit-title">Title</Label>
              <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={256} />
            </div>
            <div>
              <Label htmlFor="edit-body">Description</Label>
              <Textarea id="edit-body" value={body} onChange={(e) => setBody(e.target.value)} rows={8} />
            </div>
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => {
            const id = `field-${f.id}`;
            const value = values[f.id] ?? "";
            const set = (v: string) => setValues((prev) => ({ ...prev, [f.id]: v }));
            return (
              <div key={f.id}>
                <Label htmlFor={id}>{f.name}</Label>
                {f.dataType === "SINGLE_SELECT" || f.dataType === "ITERATION" ? (
                  <Select id={id} className="w-full" value={value} onChange={(e) => set(e.target.value)}>
                    <option value="">None</option>
                    {(f.dataType === "SINGLE_SELECT" ? (f.options ?? []).map((o) => ({ id: o.id, name: o.name })) : (f.iterations ?? []).map((i) => ({ id: i.id, name: i.title }))).map(
                      (o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ),
                    )}
                  </Select>
                ) : (
                  <Input
                    id={id}
                    type={f.dataType === "DATE" ? "date" : f.dataType === "NUMBER" ? "number" : "text"}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            Save
          </Button>
          {isIssue && task.state === "open" && (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void save({ state: "closed", stateReason: "completed" })}>
              Close task
            </Button>
          )}
          {isIssue && task.state === "closed" && (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void save({ state: "open", stateReason: "reopened" })}>
              Reopen task
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
