import { describe, expect, it } from "vitest";
import { COMMANDS, type KeyInput, RESERVED, chordOf, createMatcher, displayBinding, normalizeBinding } from "./keymap";

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });
const ALL = ["global", "list", "task"] as const;

describe("keymap data", () => {
  it("has no two commands on the same keys in the same scope", () => {
    const seen = new Map<string, string>();
    for (const c of COMMANDS) {
      for (const k of c.keys) {
        const slot = `${c.scope}:${normalizeBinding(k)}`;
        expect(seen.get(slot), `${c.id} and ${seen.get(slot)} both use ${k} in ${c.scope}`).toBeUndefined();
        seen.set(slot, c.id);
      }
    }
  });

  it("leaves Linear's keys for unbuilt pages free", () => {
    for (const c of COMMANDS) {
      for (const k of c.keys) expect(RESERVED[normalizeBinding(k)], `${c.id} takes reserved ${k}`).toBeUndefined();
    }
  });

  it("has unique ids", () => {
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
  });

  it("never binds a sequence start as a single key", () => {
    const starts = new Set(COMMANDS.flatMap((c) => c.keys.filter((k) => k.includes(" ")).map((k) => k.split(" ")[0])));
    for (const c of COMMANDS) for (const k of c.keys) if (!k.includes(" ")) expect(starts.has(k), `${c.id}: ${k}`).toBe(false);
  });

  it("lets only modifier chords and Escape fire inside inputs", () => {
    for (const c of COMMANDS.filter((c) => "inInputs" in c && c.inInputs)) {
      for (const k of c.keys) expect(k === "escape" || k.startsWith("mod+"), `${c.id}: ${k}`).toBe(true);
    }
  });
});

describe("chordOf", () => {
  it("normalizes modifiers per platform", () => {
    expect(chordOf(key("k", { metaKey: true }), true)).toBe("mod+k");
    expect(chordOf(key("k", { ctrlKey: true }), false)).toBe("mod+k");
    expect(chordOf(key("k", { ctrlKey: true }), true)).toBe("k"); // Ctrl is not mod on a Mac
  });

  it("keeps Shift on letters and drops it where the character implies it", () => {
    expect(chordOf(key("D", { shiftKey: true }), true)).toBe("shift+d");
    expect(chordOf(key("?", { shiftKey: true }), true)).toBe("?");
    expect(chordOf(key(">", { metaKey: true, shiftKey: true }), true)).toBe("mod+shift+.");
    expect(chordOf(key("<", { metaKey: true, shiftKey: true }), true)).toBe("mod+shift+,");
    expect(chordOf(key(" "), true)).toBe("space");
    expect(chordOf(key("ArrowDown", { shiftKey: true }), true)).toBe("shift+arrowdown");
  });
});

describe("createMatcher", () => {
  it("matches single chords", () => {
    const m = createMatcher(true);
    expect(m.press(key("k", { metaKey: true }), [...ALL], 0)).toBe("menu.open");
    expect(m.press(key("c"), [...ALL], 0)).toBe("task.create");
    expect(m.press(key("q"), [...ALL], 0)).toBeNull();
  });

  it("matches a two-key sequence within the time limit", () => {
    const m = createMatcher(true, 1_000);
    expect(m.press(key("g"), [...ALL], 0)).toBe("pending");
    expect(m.press(key("s"), [...ALL], 500)).toBe("go.settings");
  });

  it("drops a sequence after the time limit, and treats the second key on its own", () => {
    const m = createMatcher(true, 1_000);
    expect(m.press(key("g"), [...ALL], 0)).toBe("pending");
    expect(m.press(key("s"), [...ALL], 1_500)).toBe("task.status");
  });

  it("ignores bare modifier presses inside a sequence", () => {
    const m = createMatcher(true);
    expect(m.press(key("g"), [...ALL], 0)).toBe("pending");
    expect(m.press(key("Shift", { shiftKey: true }), [...ALL], 10)).toBeNull();
    expect(m.press(key("s"), [...ALL], 20)).toBe("go.settings");
  });

  it("only matches commands in an active scope", () => {
    const m = createMatcher(true);
    expect(m.press(key("s"), ["global"], 0)).toBeNull(); // no task in focus
    expect(m.press(key("j"), ["global"], 0)).toBeNull(); // no list on screen
    expect(m.press(key("j"), ["global", "list"], 0)).toBe("list.down");
  });
});

describe("displayBinding", () => {
  it("shows Mac and other symbols", () => {
    expect(displayBinding("mod+k", true)).toBe("⌘K");
    expect(displayBinding("mod+k", false)).toBe("Ctrl+K");
    expect(displayBinding("g s", true)).toBe("G then S");
    expect(displayBinding("shift+d", true)).toBe("⇧D");
    expect(displayBinding(undefined, true)).toBe("");
  });
});
