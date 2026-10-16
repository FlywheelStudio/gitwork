"use client";
import type { FieldMapping } from "@gitwork/server";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorText, Input, Label, Select } from "@/components/kit";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";

interface Candidates {
  installations: {
    id: number;
    login: string;
    repos: { nodeId: string; fullName: string; private: boolean }[];
    reposTruncated: boolean;
    projects: { nodeId: string; number: number; title: string; closed: boolean }[];
  }[];
}

function useRun() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, run };
}

/** Lists only what the user's own GitHub account can see; the server checks again on save. */
export function GitHubLinkPanel({ workspaceId, linked }: { workspaceId: string; linked: boolean }) {
  const { error, busy, run } = useRun();
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [installationId, setInstallationId] = useState<number | null>(null);
  const [projectNodeId, setProjectNodeId] = useState("");
  const [repos, setRepos] = useState<Set<string>>(new Set());
  const base = `/workspaces/${workspaceId}/github`;
  const inst = candidates?.installations.find((i) => i.id === installationId);

  if (!candidates) {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <Button
            variant={linked ? "secondary" : "primary"}
            disabled={busy}
            onClick={() =>
              run(async () => {
                const c = await api<Candidates>("GET", `${base}/candidates`);
                setCandidates(c);
                setInstallationId(c.installations[0]?.id ?? null);
              })
            }
          >
            {linked ? "Change board and repos" : "Choose board and repos"}
          </Button>
          {linked && (
            <Button variant="danger" disabled={busy} onClick={() => run(() => api("DELETE", base))}>
              Unlink
            </Button>
          )}
        </div>
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }

  if (candidates.installations.length === 0) {
    return <p className="text-sm text-muted-foreground">Your GitHub account cannot see any organization with the App installed.</p>;
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await api("PUT", base, { installationId, projectNodeId, repoNodeIds: [...repos] });
          setCandidates(null);
        });
      }}
    >
      <div>
        <Label htmlFor="link-org">Organization</Label>
        <Select
          id="link-org"
          value={installationId ?? ""}
          onChange={(e) => {
            setInstallationId(Number(e.target.value));
            setProjectNodeId("");
            setRepos(new Set());
          }}
        >
          {candidates.installations.map((i) => (
            <option key={i.id} value={i.id}>
              {i.login}
            </option>
          ))}
        </Select>
      </div>
      {inst && (
        <>
          <div>
            <Label htmlFor="link-board">Board</Label>
            <Select id="link-board" className="w-full" value={projectNodeId} onChange={(e) => setProjectNodeId(e.target.value)} required>
              <option value="">Pick a board</option>
              {inst.projects.map((p) => (
                <option key={p.nodeId} value={p.nodeId}>
                  {p.title} (#{p.number}){p.closed ? " — closed" : ""}
                </option>
              ))}
            </Select>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium">Repos</legend>
            {inst.repos.map((r) => {
              const id = `repo-${r.nodeId}`;
              return (
                <div key={r.nodeId} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={id}
                    checked={repos.has(r.nodeId)}
                    onCheckedChange={(on) =>
                      setRepos((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(r.nodeId);
                        else next.delete(r.nodeId);
                        return next;
                      })
                    }
                  />
                  <label htmlFor={id}>
                    {r.fullName}
                    {r.private ? " (private)" : ""}
                  </label>
                </div>
              );
            })}
            {inst.reposTruncated && <p className="text-xs text-muted-foreground">Showing the first 2,000 repos.</p>}
          </fieldset>
        </>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !projectNodeId || repos.size === 0}>
          Save link
        </Button>
        <Button type="button" variant="secondary" onClick={() => setCandidates(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const MAPPING_ROWS: { key: keyof FieldMapping; label: string; type: string }[] = [
  { key: "kanbanFieldId", label: "Kanban columns", type: "SINGLE_SELECT" },
  { key: "startFieldId", label: "Timeline start", type: "DATE" },
  { key: "targetFieldId", label: "Timeline end", type: "DATE" },
  { key: "iterationFieldId", label: "Iteration (used when a task has no dates)", type: "ITERATION" },
];

export function FieldMappingPanel(props: { workspaceId: string; fields: { id: string; name: string; dataType: string }[]; mapping: FieldMapping }) {
  const { error, busy, run } = useRun();
  const [mapping, setMapping] = useState(props.mapping);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api("PATCH", `/workspaces/${props.workspaceId}/github/fields`, mapping));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {MAPPING_ROWS.map((row) => (
          <div key={row.key}>
            <Label htmlFor={`map-${row.key}`}>{row.label}</Label>
            <Select
              id={`map-${row.key}`}
              className="w-full"
              value={mapping[row.key] ?? ""}
              onChange={(e) => setMapping((m) => ({ ...m, [row.key]: e.target.value || null }))}
            >
              {/* Empty = auto-detect by GitHub's usual field names (resolveMapping). */}
              <option value="">Auto-detect</option>
              {props.fields
                .filter((f) => f.dataType === row.type)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </Select>
          </div>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy}>
        Save fields
      </Button>
    </form>
  );
}

export function VisibilityPanel(props: { workspaceId: string; hideLabel: string; showDraftsToReadOnly: boolean }) {
  const { error, busy, run } = useRun();
  const [hideLabel, setHideLabel] = useState(props.hideLabel);
  const [drafts, setDrafts] = useState(props.showDraftsToReadOnly);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api("PATCH", `/workspaces/${props.workspaceId}/settings`, { hideLabel: hideLabel || null, showDraftsToReadOnly: drafts }));
      }}
    >
      <div>
        <Label htmlFor="hide-label">Hide issues with this label</Label>
        <Input id="hide-label" value={hideLabel} placeholder="e.g. internal" maxLength={50} onChange={(e) => setHideLabel(e.target.value)} />
        <p className="mt-1 text-xs text-muted-foreground">Read Only members never see these issues. Empty hides nothing.</p>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Checkbox id="show-drafts" checked={drafts} onCheckedChange={(on) => setDrafts(on === true)} />
        <label htmlFor="show-drafts">Show draft items to Read Only members</label>
      </div>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy}>
        Save
      </Button>
    </form>
  );
}
