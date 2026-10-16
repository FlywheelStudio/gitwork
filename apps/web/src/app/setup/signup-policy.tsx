"use client";
import { useState } from "react";
import { ErrorText, Select } from "@/components/ui";
import { api } from "@/lib/api";

export function SignupPolicy({ initial }: { initial: "open" | "invite-only" }) {
  const [policy, setPolicy] = useState(initial);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <div className="space-y-2">
      <Select
        aria-label="Who can create an account"
        value={policy}
        onChange={async (e) => {
          const next = e.target.value as typeof policy;
          setPolicy(next);
          setSaved(false);
          try {
            await api("PUT", "/setup/signups", { policy: next });
            setSaved(true);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <option value="invite-only">Invite only (recommended for private instances)</option>
        <option value="open">Anyone can sign up</option>
      </Select>
      {saved && <p className="text-sm text-zinc-500">Saved.</p>}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
