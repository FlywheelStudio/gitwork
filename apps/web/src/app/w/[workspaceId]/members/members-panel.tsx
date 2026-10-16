"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, ErrorText, Input, Label, ROLE_LABEL, Select } from "@/components/kit";
import { api } from "@/lib/api";

interface Member {
  userId: string;
  name: string;
  email: string;
  role: string;
  viaAccount: boolean;
}
interface Invite {
  id: string;
  email: string;
  role: string;
}

export function MembersPanel(props: {
  workspaceId: string;
  currentUserId: string;
  members: Member[];
  invites: Invite[];
  /** Roles this user may grant; empty when they cannot manage members. */
  grantable: string[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(props.grantable.includes("read_only") ? "read_only" : (props.grantable[0] ?? ""));
  const base = `/workspaces/${props.workspaceId}`;

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const canManage = props.grantable.length > 0;

  return (
    <div className="space-y-6">
      <ErrorText>{error}</ErrorText>

      {canManage && (
        <Card>
          <h2 className="mb-4 font-medium">Invite someone</h2>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api("POST", `${base}/invites`, { email, role });
                setEmail("");
              });
            }}
          >
            <div className="min-w-64 flex-1">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="invite-role">Role</Label>
              <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)}>
                {props.grantable.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit">Send invite</Button>
          </form>
        </Card>
      )}

      <section>
        <h2 className="mb-2 font-medium">Members</h2>
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {props.members.map((m) => {
            const self = m.userId === props.currentUserId;
            const editable = !m.viaAccount && !self && props.grantable.includes(m.role);
            return (
              <li key={m.userId} className="flex items-center justify-between gap-3 px-4 py-3" data-testid="member-row">
                <span>
                  <span className="font-medium">{m.name || m.email}</span>
                  <span className="ml-2 text-sm text-zinc-500">{m.email}</span>
                </span>
                <span className="flex items-center gap-2 text-sm">
                  {editable ? (
                    <Select
                      aria-label={`Role for ${m.email}`}
                      value={m.role}
                      onChange={(e) => void run(() => api("PATCH", `${base}/members/${m.userId}`, { role: e.target.value }))}
                    >
                      {props.grantable.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-zinc-500">
                      {ROLE_LABEL[m.role]}
                      {m.viaAccount && " (account)"}
                    </span>
                  )}
                  {(editable || (self && !m.viaAccount)) && (
                    <Button
                      variant="danger"
                      onClick={() =>
                        void run(async () => {
                          await api("DELETE", `${base}/members/${m.userId}`);
                          if (self) router.push("/");
                        })
                      }
                    >
                      {self ? "Leave" : "Remove"}
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {canManage && props.invites.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">Pending invites</h2>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {props.invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between px-4 py-3 text-sm" data-testid="invite-row">
                <span>
                  {i.email} <span className="text-zinc-500">· {ROLE_LABEL[i.role]}</span>
                </span>
                {props.grantable.includes(i.role) && (
                  <Button variant="danger" onClick={() => void run(() => api("DELETE", `${base}/invites/${i.id}`))}>
                    Cancel
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
