"use client";
import { useRef, useState } from "react";
import { Button, ErrorText, Input, Label } from "@/components/kit";
import { api } from "@/lib/api";

/**
 * GitHub's manifest flow needs a real form POST to github.com with the manifest as a field.
 * The server creates a one-time state first; then this posts the form.
 */
export function CreateAppForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [org, setOrg] = useState("");
  const [target, setTarget] = useState<{ action: string; manifest: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { action, manifest } = await api<{ action: string; manifest: unknown }>("POST", "/setup/github/manifest", {
        org: org || undefined,
      });
      setTarget({ action, manifest: JSON.stringify(manifest) });
      requestAnimationFrame(() => formRef.current?.submit());
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={start} className="space-y-4">
        <div>
          <Label htmlFor="org">GitHub organization that will own the App (optional)</Label>
          <Input id="org" placeholder="Leave empty to create it under your personal account" value={org} onChange={(e) => setOrg(e.target.value)} />
        </div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy}>
          Create GitHub App
        </Button>
      </form>
      {target && (
        <form ref={formRef} method="post" action={target.action} className="hidden">
          <input type="hidden" name="manifest" value={target.manifest} />
        </form>
      )}
    </>
  );
}
