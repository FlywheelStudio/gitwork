"use client";
import type { TaskView } from "@gitwork/server";
import { useState } from "react";
import { Button, ErrorText, Input, Label, Select, Textarea } from "@/components/kit";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useBoard, useBoardContext, useTaskActions } from "../board-context";
import { WritePath } from "./peek-panel";

export function NewTaskButton() {
  const board = useBoard();
  const { workspaceId, openPeek, newTaskOpen: open, setNewTaskOpen: setOpen, setFocusedId } = useBoardContext();
  const { upsert } = useTaskActions();
  const props = {
    workspaceId,
    repos: board.repos,
    defaultRepo: board.lastRepoNodeId,
    statusField: board.fields.find((f) => f.id === board.mapping.kanbanFieldId) ?? null,
  };
  const [repo, setRepo] = useState(props.defaultRepo ?? props.repos[0]?.nodeId ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { task } = await api<{ task: TaskView }>("POST", `/workspaces/${props.workspaceId}/tasks`, {
        repoNodeId: repo,
        title,
        body: body || undefined,
        fields: status && props.statusField ? { [props.statusField.id]: { type: "single_select", optionId: status } } : undefined,
      });
      setOpen(false);
      setTitle("");
      setBody("");
      // The new task joins the store and opens beside the list: no page load.
      upsert(task);
      setFocusedId(task.id);
      openPeek(task.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button title="New task (C)">
          New task <kbd className="ml-1 rounded border border-primary-foreground/30 px-1 font-mono text-xs opacity-70">C</kbd>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Creates a GitHub issue and adds it to the board.</DialogDescription>
          <WritePath />
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="new-repo">Repo</Label>
            <Select id="new-repo" className="w-full" value={repo} onChange={(e) => setRepo(e.target.value)}>
              {props.repos.map((r) => (
                <option key={r.nodeId} value={r.nodeId}>
                  {r.fullName}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="new-title">Title</Label>
            <Input id="new-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={256} />
          </div>
          <div>
            <Label htmlFor="new-body">Description</Label>
            <Textarea id="new-body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
          </div>
          {props.statusField && (
            <div>
              <Label htmlFor="new-status">{props.statusField.name}</Label>
              <Select id="new-status" className="w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">None</option>
                {props.statusField.options?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy || !title.trim() || !repo}>
            Create task
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
