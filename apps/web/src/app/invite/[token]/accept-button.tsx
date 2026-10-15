"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorText } from "@/components/ui";
import { api } from "@/lib/api";

export function AcceptButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { workspaceId } = await api<{ workspaceId: string }>("POST", `/invites/${encodeURIComponent(token)}/accept`);
            router.push(`/w/${workspaceId}`);
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        Accept invite
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
