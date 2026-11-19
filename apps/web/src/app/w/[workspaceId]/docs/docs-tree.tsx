"use client";
import type { DocFileView, DocRepoView } from "@gitwork/server";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, ErrorText, Input } from "@/components/kit";
import { api } from "@/lib/api";
import { decodeSegment, docHref, rawHref } from "./links";

interface Folder {
  name: string;
  path: string;
  folders: Map<string, Folder>;
  files: DocFileView[];
}

function buildTree(repo: DocRepoView): Folder {
  const root: Folder = { name: repo.root, path: repo.root, folders: new Map(), files: [] };
  for (const file of repo.files) {
    const parts = file.path.slice(repo.root.length + 1).split("/");
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      let next = folder.folders.get(part);
      if (!next) {
        next = { name: part, path: `${folder.path}/${part}`, folders: new Map(), files: [] };
        folder.folders.set(part, next);
      }
      folder = next;
    }
    folder.files.push(file);
  }
  return root;
}

const STATUS_TEXT: Record<DocRepoView["status"], string> = {
  ok: "",
  unsynced: "Not loaded from GitHub yet.",
  missing: "This folder does not exist on the branch yet. Create a doc to start it.",
  unavailable: "The GitHub App cannot reach this repo right now.",
};

export function DocsTree(props: { workspaceId: string; linked: boolean; repos: DocRepoView[]; canWrite: boolean }) {
  const router = useRouter();
  const params = useParams<{ repoNodeId?: string; path?: string[] }>();
  const current = params.repoNodeId && params.path ? `${decodeSegment(params.repoNodeId)}:${params.path.map(decodeSegment).join("/")}` : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const [name, setName] = useState("");

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      await api("POST", `/workspaces/${props.workspaceId}/docs/refresh`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function create(repo: DocRepoView) {
    const clean = name.trim().replace(/^\/+/, "");
    if (!clean) return;
    const path = `${repo.root}/${/\.(md|markdown)$/i.test(clean) ? clean : `${clean}.md`}`;
    setBusy(true);
    setError("");
    try {
      await api("POST", `/workspaces/${props.workspaceId}/docs/file`, { repoNodeId: repo.repoNodeId, path });
      setCreating(null);
      setName("");
      router.push(docHref(props.workspaceId, repo.repoNodeId, path));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!props.linked) return null;
  return (
    <aside aria-label="Docs" className="shrink-0 space-y-4 text-sm md:w-64">
      {props.repos.map((repo) => (
        <section key={repo.repoNodeId} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="truncate text-xs font-medium text-muted-foreground" title={`${repo.fullName} · ${repo.root}/ on ${repo.branch}`}>
              {repo.fullName}
            </h2>
            {props.canWrite && repo.status !== "unavailable" && (
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setCreating(creating === repo.repoNodeId ? null : repo.repoNodeId)}>
                + New doc
              </button>
            )}
          </div>
          {creating === repo.repoNodeId && (
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                void create(repo);
              }}
            >
              <Input autoFocus aria-label="New doc name" placeholder="guide/intro.md" value={name} onChange={(e) => setName(e.target.value)} className="h-7" />
              <Button type="submit" disabled={busy} className="h-7">
                Add
              </Button>
            </form>
          )}
          {repo.status !== "ok" && (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>{STATUS_TEXT[repo.status]}</p>
              {repo.status === "unsynced" && props.canWrite && (
                <Button variant="secondary" className="h-7" disabled={busy} onClick={() => void refresh()}>
                  Load from GitHub
                </Button>
              )}
            </div>
          )}
          {repo.status === "ok" && <FolderView workspaceId={props.workspaceId} repo={repo} folder={buildTree(repo)} current={current} depth={0} />}
          {repo.status === "ok" && repo.files.length === 0 && <p className="text-xs text-muted-foreground">No files in {repo.root}/ yet.</p>}
          {repo.truncated && <p className="text-xs text-amber-600">This folder has more files than Gitwork lists.</p>}
        </section>
      ))}
      <ErrorText>{error}</ErrorText>
    </aside>
  );
}

function FolderView(props: { workspaceId: string; repo: DocRepoView; folder: Folder; current: string | null; depth: number }) {
  const { folder, repo, depth } = props;
  const folders = useMemo(() => [...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name)), [folder]);
  const [open, setOpen] = useState(true);
  const body = (
    <ul className="space-y-0.5">
      {folders.map((f) => (
        <li key={f.path}>
          <FolderView {...props} folder={f} depth={depth + 1} />
        </li>
      ))}
      {folder.files.map((file) => {
        const name = file.path.split("/").pop()!;
        const active = props.current === `${repo.repoNodeId}:${file.path}`;
        const cls = `flex items-center justify-between gap-2 rounded-md px-2 py-1 ${active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`;
        return (
          <li key={file.path}>
            {file.kind === "doc" ? (
              <Link href={docHref(props.workspaceId, repo.repoNodeId, file.path)} aria-current={active ? "page" : undefined} className={cls}>
                <span className="truncate">{name.replace(/\.(md|markdown)$/i, "")}</span>
                {file.pending && (
                  <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" title={`Pending review in pull request #${file.pending.number}`}>
                    PR
                  </span>
                )}
              </Link>
            ) : (
              <a href={rawHref(props.workspaceId, repo.repoNodeId, file.path)} target="_blank" rel="noreferrer" className={cls}>
                <span className="truncate">{name}</span>
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
  if (depth === 0) return body;
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-muted-foreground hover:bg-muted">
        <span aria-hidden className="w-3 text-xs">
          {open ? "▾" : "▸"}
        </span>
        <span className="truncate">{folder.name}</span>
      </button>
      {open && <div className="ml-3 border-l border-border pl-1">{body}</div>}
    </div>
  );
}
