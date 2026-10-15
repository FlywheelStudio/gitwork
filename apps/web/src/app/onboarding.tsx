"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, ErrorText, Input, Label } from "@/components/ui";
import { api } from "@/lib/api";

export function Onboarding() {
  const router = useRouter();
  const [accountName, setAccountName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { workspaceId } = await api<{ workspaceId: string }>("POST", "/accounts", { accountName, workspaceName });
      router.push(`/w/${workspaceId}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <h1 className="mb-1 text-xl font-semibold">Create your account</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        An account holds your workspaces. Each workspace is one project.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="accountName">Account name</Label>
          <Input id="accountName" required placeholder="Your agency or your name" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="workspaceName">First workspace</Label>
          <Input id="workspaceName" required placeholder="e.g. Acme website" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} />
        </div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy} className="w-full">
          Create
        </Button>
      </form>
    </Card>
  );
}
