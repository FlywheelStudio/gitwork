"use client";
/**
 * Keyboard shortcuts and the command menu for a workspace's tasks (roadmap Track C, decision 028).
 * Every action here is also a command-menu item, so a person who knows no keys can still find it.
 */
import { COMMANDS, type Command as KeyCommand, type CommandId, commandById, displayBinding } from "@gitwork/core";
import type { FieldView, TaskView } from "@gitwork/server";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, Input } from "@/components/kit";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fromInputValue, toInputValue } from "@/lib/field-values";
import { type Handlers, isMac, useShortcuts } from "@/lib/keyboard";
import { useBoard, useBoardContext, useSnapshot, useTaskActions } from "./board-context";
import type { ViewId } from "./views";

type FieldRole = "status" | "priority" | "estimate" | "due" | "cycle";

type Mode = { kind: "root" } | { kind: "search" } | { kind: "pick"; role: FieldRole } | { kind: "value"; role: FieldRole };

/** The board field each task command edits, if the board has one. */
function useRoleFields(): Partial<Record<FieldRole, FieldView>> {
  const { fields, mapping } = useBoard();
  return useMemo(() => {
    const byId = (id: string | null) => fields.find((f) => f.id === id);
    const byName = (type: string, pattern: RegExp) => fields.find((f) => f.dataType === type && pattern.test(f.name));
    return {
      status: byId(mapping.kanbanFieldId),
      priority: byName("SINGLE_SELECT", /^priority$/i),
      estimate: byName("NUMBER", /^(estimate|points|story points)$/i),
      due: byId(mapping.targetFieldId),
      cycle: byId(mapping.iterationFieldId),
    };
  }, [fields, mapping]);
}

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export function CommandLayer({ view, setView }: { view: ViewId; setView: (v: ViewId) => void }) {
  const router = useRouter();
  const ctx = useBoardContext();
  const { workspaceId, peekId, openPeek, closePeek, focusedId, setFocusedId, selected, setSelected, getOrder, notify, setNewTaskOpen } = ctx;
  const board = useBoard();
  const { canWrite } = useSnapshot();
  const actions = useTaskActions();
  const roles = useRoleFields();
  const [mode, setMode] = useState<Mode | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const mac = isMac();

  const byId = useMemo(() => new Map(board.tasks.map((t) => [t.id, t])), [board.tasks]);
  /** What a task command acts on: the selection, else the task in focus, else the open panel. */
  const targets: TaskView[] = useMemo(() => {
    if (selected.size > 0) return [...selected].flatMap((id) => byId.get(id) ?? []);
    const one = (focusedId && byId.get(focusedId)) || (peekId && byId.get(peekId));
    return one ? [one] : [];
  }, [selected, focusedId, peekId, byId]);
  const single = targets.length === 1 ? targets[0]! : null;

  function moveFocus(step: 1 | -1, extend = false) {
    const ids = getOrder();
    if (ids.length === 0) return;
    const at = focusedId ? ids.indexOf(focusedId) : -1;
    const next = ids[Math.max(0, Math.min(ids.length - 1, at === -1 ? 0 : at + step))]!;
    if (extend) {
      const from = focusedId ?? next;
      setSelected(new Set([...selected, from, next]));
    }
    setFocusedId(next);
    if (peekId) openPeek(next); // the panel follows the focus, as in Linear
    document.querySelector(`[data-task-id="${CSS.escape(next)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify(`Copied ${what}: ${text}`);
    } catch {
      notify(`Could not copy the ${what}.`);
    }
  }

  const ref = (t: TaskView) => (t.repo && t.number !== null ? `${t.repo.fullName}#${t.number}` : t.title);
  const appUrl = (t: TaskView) => `${window.location.origin}/w/${workspaceId}/tasks/${encodeURIComponent(t.id)}`;

  const edit = (role: FieldRole) => () => {
    if (!canWrite) return notify("Your role cannot edit tasks.");
    if (!roles[role]) return notify(`This board has no ${role === "due" ? "due date" : role} field.`);
    if (targets.length === 0) return notify("Move to a task first (J / K), or select some (X).");
    setMode({ kind: roles[role]!.dataType === "SINGLE_SELECT" || roles[role]!.dataType === "ITERATION" ? "pick" : "value", role });
  };

  const handlers: Handlers = {
    "menu.open": () => setMode((m) => (m ? null : { kind: "root" })),
    "search.open": () => setMode({ kind: "search" }),
    "help.shortcuts": () => setHelpOpen(true),
    "task.create": canWrite && board.board.available && board.repos.length > 0 ? () => setNewTaskOpen(true) : undefined,
    "edit.undo": () => void actions.undo(),
    escape: () => {
      if (peekId) closePeek();
      else if (selected.size > 0) setSelected(new Set());
      else setFocusedId(null);
    },
    "go.tasks": () => router.push(`/w/${workspaceId}`),
    "go.members": () => router.push(`/w/${workspaceId}/members`),
    "go.settings": () => router.push(`/w/${workspaceId}/settings`),
    "view.toggle": () => setView(view === "list" ? "board" : "list"),
    "view.list": () => setView("list"),
    "view.board": () => setView("board"),
    "view.timeline": () => setView("timeline"),
    "list.down": () => moveFocus(1),
    "list.up": () => moveFocus(-1),
    "list.extendDown": () => moveFocus(1, true),
    "list.extendUp": () => moveFocus(-1, true),
    "list.select": () => {
      if (!focusedId) return;
      const next = new Set(selected);
      if (next.has(focusedId)) next.delete(focusedId);
      else next.add(focusedId);
      setSelected(next);
    },
    "list.selectAll": () => setSelected(new Set(getOrder())),
    "list.peek": () => focusedId && (peekId === focusedId ? closePeek() : openPeek(focusedId)),
    "list.open": () => focusedId && router.push(`/w/${workspaceId}/tasks/${encodeURIComponent(focusedId)}`),
    "task.status": edit("status"),
    "task.priority": edit("priority"),
    "task.estimate": edit("estimate"),
    "task.dueDate": edit("due"),
    "task.cycle": edit("cycle"),
    "task.close": () => {
      if (!canWrite || !single || single.kind !== "issue") return;
      void actions.setState(single, single.state === "closed" ? "open" : "closed");
    },
    "task.copyId": () => single && void copy(ref(single), "ID"),
    "task.copyUrl": () => single && void copy(appUrl(single), "URL"),
    "task.copyBranch": () => single && single.number !== null && void copy(`${single.number}-${slug(single.title)}`, "branch name"),
  };

  const scopes: ("global" | "list" | "task")[] = ["global", "list", ...(targets.length > 0 ? (["task"] as const) : [])];
  useShortcuts(handlers, scopes);

  // ---- Menu content -------------------------------------------------------------------------

  const [query, setQuery] = useState("");
  const close = () => {
    setMode(null);
    setQuery("");
    // The menu animates out with its input still focused; shortcuts must work at once.
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('[role="dialog"]')) document.activeElement.blur();
  };
  const run = (id: CommandId) => {
    close();
    handlers[id]?.();
  };
  const matches = useMemo(() => {
    if (!mode || (mode.kind !== "root" && mode.kind !== "search")) return [];
    const q = query.trim().toLowerCase();
    if (!q) return mode.kind === "search" ? board.tasks.slice(0, 20) : [];
    const out: TaskView[] = [];
    for (const t of board.tasks) {
      if (t.title.toLowerCase().includes(q) || (t.number !== null && `#${t.number}`.includes(q)) || ref(t).toLowerCase().includes(q)) out.push(t);
      if (out.length === 30) break;
    }
    return out;
  }, [mode, query, board.tasks]);

  const available = (COMMANDS as readonly KeyCommand[]).filter(
    (c) => handlers[c.id] && c.id !== "menu.open" && c.id !== "escape" && (c.scope !== "task" || targets.length > 0) && !c.id.startsWith("list."),
  );
  const keysOf = (c: KeyCommand) => displayBinding(c.keys[0]!, mac);

  const pickField = mode?.kind === "pick" || mode?.kind === "value" ? roles[mode.role] : undefined;
  const targetLabel = targets.length === 1 ? `“${targets[0]!.title}”` : `${targets.length} tasks`;

  return (
    <>
      <CommandDialog
        open={mode !== null && mode.kind !== "value"}
        onOpenChange={(open) => !open && close()}
        title={mode?.kind === "pick" ? `Set ${pickField?.name}` : "Command menu"}
        description={mode?.kind === "pick" ? `For ${targetLabel}` : "Search tasks or run a command"}
      >
        <Command loop>
          <CommandInput
            placeholder={mode?.kind === "pick" ? `Set ${pickField?.name} for ${targetLabel}…` : mode?.kind === "search" ? "Search tasks…" : "Type a command or search…"}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            {mode?.kind === "pick" && pickField && (
              <CommandGroup heading={pickField.name}>
                {(pickField.dataType === "SINGLE_SELECT"
                  ? (pickField.options ?? []).map((o) => ({ id: o.id, name: o.name }))
                  : (pickField.iterations ?? []).map((i) => ({ id: i.id, name: i.title }))
                ).map((o) => (
                  <CommandItem
                    key={o.id}
                    value={o.name}
                    onSelect={() => {
                      close();
                      void actions.setFieldMany(targets, pickField, fromInputValue(pickField, o.id));
                    }}
                  >
                    {o.name}
                    {single && toInputValue(single.fields[pickField.id]) === o.id && <CommandShortcut>current</CommandShortcut>}
                  </CommandItem>
                ))}
                <CommandItem
                  value={`No ${pickField.name}`}
                  onSelect={() => {
                    close();
                    void actions.setFieldMany(targets, pickField, null);
                  }}
                >
                  No {pickField.name}
                </CommandItem>
              </CommandGroup>
            )}
            {(mode?.kind === "root" || mode?.kind === "search") && matches.length > 0 && (
              <CommandGroup heading="Tasks">
                {matches.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`task ${t.id} ${t.title}`}
                    onSelect={() => {
                      close();
                      setFocusedId(t.id);
                      openPeek(t.id);
                    }}
                  >
                    <span className="truncate">{t.title || "(untitled)"}</span>
                    <CommandShortcut>{t.repo ? `${t.repo.fullName.split("/")[1]}#${t.number}` : "Draft"}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {mode?.kind === "root" &&
              (["General", "Task", "Views", "Navigation"] as const).map((group) => {
                const items = available.filter((c) => c.group === group);
                if (items.length === 0) return null;
                return (
                  <CommandGroup key={group} heading={group === "Task" ? `Task — ${targetLabel}` : group}>
                    {items.map((c) => (
                      <CommandItem key={c.id} value={c.label} onSelect={() => run(c.id)}>
                        {c.label}
                        <CommandShortcut>{keysOf(c)}</CommandShortcut>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
          </CommandList>
        </Command>
      </CommandDialog>

      {mode?.kind === "value" && pickField && (
        <ValueDialog
          field={pickField}
          initial={single ? toInputValue(single.fields[pickField.id]) : ""}
          targetLabel={targetLabel}
          onClose={close}
          onSave={(value) => {
            close();
            void actions.setFieldMany(targets, pickField, fromInputValue(pickField, value));
          }}
        />
      )}

      <ShortcutSheet open={helpOpen} onOpenChange={setHelpOpen} mac={mac} />
      <SelectionBar count={selected.size} onClear={() => setSelected(new Set())} onStatus={canWrite && roles.status ? edit("status") : undefined} mac={mac} />
    </>
  );
}

function ValueDialog(props: { field: FieldView; initial: string; targetLabel: string; onClose: () => void; onSave: (value: string) => void }) {
  const [value, setValue] = useState(props.initial);
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Set {props.field.name}</DialogTitle>
          <DialogDescription>For {props.targetLabel}. Leave it empty to clear.</DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            props.onSave(value);
          }}
        >
          <Input
            aria-label={props.field.name}
            autoFocus
            className="flex-1"
            type={props.field.dataType === "DATE" ? "date" : props.field.dataType === "NUMBER" ? "number" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button type="submit">Save</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutSheet({ open, onOpenChange, mac }: { open: boolean; onOpenChange: (open: boolean) => void; mac: boolean }) {
  const groups = ["General", "Navigation", "Views", "List", "Task"] as const;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>The same keys as Linear. Press ? anywhere to see this again.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4" data-testid="shortcut-sheet">
          {groups.map((g) => (
            <section key={g}>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground uppercase">{g}</h3>
              <dl className="divide-y divide-border text-sm">
                {(COMMANDS as readonly KeyCommand[])
                  .filter((c) => c.group === g)
                  .map((c) => (
                    <div key={c.id} className="flex justify-between gap-4 py-1.5">
                      <dt>{c.label}</dt>
                      <dd className="flex gap-1 text-muted-foreground">
                        {c.keys.map((k) => (
                          <kbd key={k} className="rounded border border-border bg-muted px-1.5 font-mono text-xs">
                            {displayBinding(k, mac)}
                          </kbd>
                        ))}
                      </dd>
                    </div>
                  ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SelectionBar({ count, onClear, onStatus, mac }: { count: number; onClear: () => void; onStatus?: () => void; mac: boolean }) {
  if (count === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-16 z-30 flex justify-center" data-testid="selection-bar">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-lg">
        <span>{count} selected</span>
        {onStatus && (
          <Button size="sm" variant="secondary" onClick={onStatus}>
            Set status <kbd className="ml-1 text-xs text-muted-foreground">{displayBinding(commandById("task.status").keys[0]!, mac)}</kbd>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear <kbd className="ml-1 text-xs text-muted-foreground">Esc</kbd>
        </Button>
      </div>
    </div>
  );
}
