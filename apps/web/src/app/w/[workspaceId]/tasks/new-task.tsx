"use client";
import type { FieldView } from "@gitwork/server";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorText, Input, Label, Select, Textarea } from "@/components/kit";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api } from "@/lib/api";

export function NewTaskButton(props: {
  workspaceId: string;
  repos: { nodeId: string; fullName: string }[];
  defaultRepo: string | null;
  statusField: FieldView | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
      const { task } = await api<{ task: { id: string } }>("POST", `/workspaces/${props.workspaceId}/tasks`, {
        repoNodeId: repo,
        title,
        body: body || undefined,
        fields: status && props.statusField ? { [props.statusField.id]: { type: "single_select", optionId: status } } : undefined,
      });
      setOpen(false);
      setTitle("");
      setBody("");
      router.push(`/w/${props.workspaceId}/tasks/${encodeURIComponent(task.id)}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New task</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Creates a GitHub issue and adds it to the board.</DialogDescription>
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
