/**
 * Every keyboard shortcut, as data (decision 028). The web app and the Mac app read this file:
 * the web app binds it in apps/web/src/lib/keyboard.ts, the Mac app exports it as JSON.
 *
 * Keys follow Linear's defaults. A binding is one chord ("c", "mod+k", "shift+d") or a sequence
 * of chords separated by a space ("g s": press G, then S). "mod" is Cmd on macOS, Ctrl elsewhere.
 */

export type Scope = "global" | "list" | "task";

export interface Command {
  id: CommandId;
  label: string;
  /** Alternative bindings for the same command. Empty: command menu only. */
  keys: string[];
  scope: Scope;
  /** Group heading in the shortcut sheet. */
  group: "General" | "Navigation" | "Views" | "List" | "Task";
  /** Fires even while typing in a field (only for chords with a modifier, and Escape). */
  inInputs?: boolean;
}

export const COMMANDS = [
  // General
  { id: "menu.open", label: "Open command menu", keys: ["mod+k"], scope: "global", group: "General", inInputs: true },
  { id: "search.open", label: "Search tasks", keys: ["/"], scope: "global", group: "General" },
  { id: "help.shortcuts", label: "Show keyboard shortcuts", keys: ["?", "mod+/"], scope: "global", group: "General" },
  { id: "task.create", label: "New task", keys: ["c"], scope: "global", group: "General" },
  { id: "edit.undo", label: "Undo", keys: ["mod+z"], scope: "global", group: "General" },
  { id: "escape", label: "Close panel, then clear selection", keys: ["escape"], scope: "global", group: "General", inInputs: true },
  // Navigation
  // G then I / M / T / V are Linear's Inbox / My tasks / Triage / Views; they arrive with those
  // pages (RESERVED below). Tasks and Members are menu-only until then.
  { id: "go.tasks", label: "Go to tasks", keys: [], scope: "global", group: "Navigation" },
  { id: "go.members", label: "Go to members", keys: [], scope: "global", group: "Navigation" },
  { id: "go.settings", label: "Go to settings", keys: ["g s"], scope: "global", group: "Navigation" },
  // Views
  { id: "view.toggle", label: "Switch list ↔ board", keys: ["mod+b"], scope: "global", group: "Views" },
  { id: "view.list", label: "List view", keys: ["v l"], scope: "global", group: "Views" },
  { id: "view.board", label: "Board view", keys: ["v b"], scope: "global", group: "Views" },
  { id: "view.timeline", label: "Timeline view", keys: ["v t"], scope: "global", group: "Views" },
  // List
  { id: "list.down", label: "Move down", keys: ["j", "arrowdown"], scope: "list", group: "List" },
  { id: "list.up", label: "Move up", keys: ["k", "arrowup"], scope: "list", group: "List" },
  { id: "list.select", label: "Select the focused task", keys: ["x"], scope: "list", group: "List" },
  { id: "list.extendDown", label: "Extend selection down", keys: ["shift+arrowdown", "shift+j"], scope: "list", group: "List" },
  { id: "list.extendUp", label: "Extend selection up", keys: ["shift+arrowup", "shift+k"], scope: "list", group: "List" },
  { id: "list.selectAll", label: "Select all", keys: ["mod+a"], scope: "list", group: "List" },
  { id: "list.peek", label: "Open in side panel", keys: ["space"], scope: "list", group: "List" },
  { id: "list.open", label: "Open task page", keys: ["enter"], scope: "list", group: "List" },
  // Task: the focused task, or every selected task
  { id: "task.status", label: "Set status", keys: ["s"], scope: "task", group: "Task" },
  { id: "task.priority", label: "Set priority", keys: ["p"], scope: "task", group: "Task" },
  { id: "task.estimate", label: "Set estimate", keys: ["e"], scope: "task", group: "Task" },
  { id: "task.dueDate", label: "Set due date", keys: ["shift+d"], scope: "task", group: "Task" },
  { id: "task.cycle", label: "Set cycle (iteration)", keys: ["shift+c"], scope: "task", group: "Task" },
  { id: "task.close", label: "Close or reopen", keys: ["mod+shift+x"], scope: "task", group: "Task" },
  { id: "task.copyId", label: "Copy ID", keys: ["mod+."], scope: "task", group: "Task" },
  { id: "task.copyUrl", label: "Copy URL", keys: ["mod+shift+,"], scope: "task", group: "Task" },
  { id: "task.copyBranch", label: "Copy branch name", keys: ["mod+shift+."], scope: "task", group: "Task" },
] as const satisfies readonly (Omit<Command, "id"> & { id: string })[];

export type CommandId = (typeof COMMANDS)[number]["id"];

/**
 * Keys that keep Linear's meaning for pages Gitwork has not built yet (decision 028, roadmap
 * Track C). No other command may take them, so nobody learns a key that later changes.
 */
export const RESERVED: Record<string, string> = {
  "g i": "Go to inbox",
  "g m": "Go to my tasks",
  "g t": "Go to triage",
  "g v": "Go to views",
  f: "Filter",
  a: "Assignees",
  i: "Assign to me",
  l: "Labels",
  "shift+p": "Project",
};

/** The keys of one keyboard event, as the matcher needs them. */
export interface KeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** A normalized chord: "mod+shift+d". Modifiers in a fixed order. */
export function chordOf(e: KeyInput, isMac: boolean): string {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  // With a modifier, Shift+, and Shift+. arrive as "<" and ">" on US layouts.
  const unshifted = mod && e.shiftKey ? ({ "<": ",", ">": "." } as Record<string, string>)[e.key] : undefined;
  const key = normalizeKey(unshifted ?? e.key);
  // "?" and "<" already imply Shift on most layouts; keep Shift only where it changes meaning.
  const shiftImplied = key.length === 1 && !/[a-z0-9]/.test(key) && !mod;
  const parts = [mod && "mod", e.altKey && "alt", e.shiftKey && !shiftImplied && "shift", key].filter(Boolean);
  return parts.join("+");
}

function normalizeKey(key: string): string {
  if (key === " ") return "space";
  if (key === "Esc") return "escape";
  // Shift+letter arrives as "D"; the chord says "shift+d". Named keys: "ArrowDown" → "arrowdown".
  return key.toLowerCase();
}

/** Canonical form of a binding string, so "Shift+D" and "shift+d" compare equal. */
export function normalizeBinding(binding: string): string {
  return binding
    .split(" ")
    .map((chord) => {
      const parts = chord.toLowerCase().split("+");
      const key = parts.pop()!;
      const mods = ["mod", "alt", "shift"].filter((m) => parts.includes(m));
      return [...mods, key].join("+");
    })
    .join(" ");
}

/** The first chord of every multi-chord binding: pressing one starts a sequence. */
const SEQUENCE_STARTS = new Set(
  (COMMANDS as readonly Command[]).flatMap((c) => c.keys.filter((k) => k.includes(" ")).map((k) => normalizeBinding(k).split(" ")[0]!)),
);

export interface Matcher {
  /**
   * Feeds one key press. Returns the command for the binding it completes, "pending" when it
   * starts a sequence, or null.
   */
  press(e: KeyInput, active: Scope[], now: number): CommandId | "pending" | null;
}

/** A stateful matcher. Sequences time out after `sequenceMs`. */
export function createMatcher(isMac: boolean, sequenceMs = 1_000): Matcher {
  let prefix: { chord: string; at: number } | null = null;
  const table = new Map<string, { id: CommandId; scope: Scope }[]>();
  for (const c of COMMANDS as readonly Command[]) {
    for (const k of c.keys) {
      const b = normalizeBinding(k);
      table.set(b, [...(table.get(b) ?? []), { id: c.id, scope: c.scope }]);
    }
  }
  const find = (binding: string, active: Scope[]) => {
    const hits = table.get(binding) ?? [];
    // The most specific active scope wins: task over list over global.
    for (const scope of ["task", "list", "global"] as const) {
      if (!active.includes(scope)) continue;
      const hit = hits.find((h) => h.scope === scope);
      if (hit) return hit.id;
    }
    return null;
  };

  return {
    press(e, active, now) {
      if (["shift", "meta", "control", "alt"].includes(e.key.toLowerCase())) return null;
      const chord = chordOf(e, isMac);
      if (prefix && now - prefix.at <= sequenceMs) {
        const id = find(`${prefix.chord} ${chord}`, active);
        prefix = null;
        if (id) return id;
      }
      prefix = null;
      if (SEQUENCE_STARTS.has(chord)) {
        prefix = { chord, at: now };
        return "pending";
      }
      return find(chord, active);
    },
  };
}

/** Display form of a binding: "⌘K", "G then S". An empty binding (menu only) shows nothing. */
export function displayBinding(binding: string | undefined, isMac: boolean): string {
  if (!binding) return "";
  const names: Record<string, string> = isMac
    ? { mod: "⌘", shift: "⇧", alt: "⌥", escape: "Esc", enter: "↵", space: "Space", arrowdown: "↓", arrowup: "↑" }
    : { mod: "Ctrl+", shift: "Shift+", alt: "Alt+", escape: "Esc", enter: "Enter", space: "Space", arrowdown: "↓", arrowup: "↑" };
  return normalizeBinding(binding)
    .split(" ")
    .map((chord) =>
      chord
        .split("+")
        .map((p) => names[p] ?? p.toUpperCase())
        .join(""),
    )
    .join(" then ");
}

export function commandById(id: CommandId): Command {
  return (COMMANDS as readonly Command[]).find((c) => c.id === id)!;
}
