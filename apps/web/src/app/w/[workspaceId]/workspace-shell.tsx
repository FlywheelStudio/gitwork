"use client";
import { APP_NAME, displayBinding } from "@gitwork/core";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { ROLE_LABEL } from "@/components/kit";
import { SignOutButton } from "@/components/sign-out-button";
import type { Snapshot } from "@/lib/board-store";
import { isMac } from "@/lib/keyboard";
import { BoardProvider, useBoardContext, useLinked, useSyncState } from "./board-context";
import { CommandLayer } from "./command-layer";
import { PeekPanel } from "./tasks/peek-panel";

export function WorkspaceShell(props: {
  workspaceId: string;
  name: string;
  role: string;
  email: string;
  initial: Snapshot;
  etag: string;
  children: ReactNode;
}) {
  return (
    <BoardProvider workspaceId={props.workspaceId} initial={props.initial} etag={props.etag}>
      <div className="flex min-h-svh flex-1 flex-col md:flex-row">
        <Sidebar workspaceId={props.workspaceId} name={props.name} role={props.role} email={props.email} />
        <main className="min-w-0 flex-1 p-4 md:p-6">{props.children}</main>
      </div>
      <Layers />
    </BoardProvider>
  );
}

/** Panel, command menu, and notices: on every workspace page. */
function Layers() {
  const linked = useLinked();
  const { notice } = useBoardContext();
  return (
    <>
      {linked && <PeekPanel />}
      <CommandLayer />
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center">
        {notice && <p className="pointer-events-auto rounded-lg bg-foreground px-3 py-2 text-sm text-background shadow-lg">{notice}</p>}
      </div>
    </>
  );
}

function Sidebar({ workspaceId, name, role, email }: { workspaceId: string; name: string; role: string; email: string }) {
  const pathname = usePathname();
  const { runCommand } = useBoardContext();
  // The server cannot know the platform; the client corrects it after hydration.
  const mac = useSyncExternalStore(noSubscribe, isMac, () => false);
  const base = `/w/${workspaceId}`;
  const links = [
    { href: base, label: "Tasks", active: pathname === base || pathname.startsWith(`${base}/tasks`) },
    { href: `${base}/members`, label: "Members", active: pathname === `${base}/members` },
    ...(role === "owner" || role === "admin" ? [{ href: `${base}/settings`, label: "Settings", active: pathname === `${base}/settings` }] : []),
  ];

  return (
    <aside className="flex shrink-0 flex-col gap-4 border-b border-border bg-muted/30 p-4 md:sticky md:top-0 md:h-svh md:w-60 md:border-r md:border-b-0">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold" title="All workspaces">
          {APP_NAME}
        </Link>
        <SyncDot />
      </div>
      <div>
        <h1 className="truncate text-base font-semibold" title={name}>
          {name}
        </h1>
        <p className="text-xs text-muted-foreground">Your role: {ROLE_LABEL[role]}</p>
      </div>
      <button
        type="button"
        onClick={() => runCommand("menu.open")}
        className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
      >
        Search or run a command
        <kbd className="font-mono text-xs">{displayBinding("mod+k", mac)}</kbd>
      </button>
      <nav aria-label="Workspace" className="flex gap-1 md:flex-col">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={l.active ? "page" : undefined}
            className={`rounded-md px-2 py-1.5 text-sm ${l.active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto hidden space-y-2 text-sm md:block">
        <button type="button" onClick={() => runCommand("help.shortcuts")} className="flex w-full justify-between text-muted-foreground hover:text-foreground">
          Keyboard shortcuts <kbd className="font-mono text-xs">?</kbd>
        </button>
        <SyncText />
        <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
          <Link href="/settings" className="truncate text-xs text-muted-foreground hover:underline" title={email}>
            {email}
          </Link>
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}

const noSubscribe = () => () => {};

/** "Synced 20 s ago". Amber while the last poll failed. */
function SyncText() {
  const sync = useSyncState();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.round((now - sync.lastSyncedAt) / 1000));
  const ago = seconds < 10 ? "just now" : seconds < 60 ? `${seconds} s ago` : `${Math.round(seconds / 60)} min ago`;
  return (
    <p className={`text-xs ${sync.error ? "text-amber-600" : "text-muted-foreground"}`} data-testid="sync-status" title={sync.error ?? undefined}>
      {sync.error ? `Not synced — retrying (last ${ago})` : `Synced ${ago}`}
    </p>
  );
}

function SyncDot() {
  const sync = useSyncState();
  return (
    <span
      aria-hidden
      className={`size-2 rounded-full ${sync.error ? "bg-amber-500" : "bg-emerald-500"}`}
      title={sync.error ? "Not synced" : "Synced"}
    />
  );
}
