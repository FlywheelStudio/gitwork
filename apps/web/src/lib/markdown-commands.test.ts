import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { insertLink, setLinePrefix, toggleWrap } from "./markdown-commands";

const at = (doc: string, from: number, to = from) => EditorState.create({ doc, selection: EditorSelection.single(from, to), extensions: EditorState.allowMultipleSelections.of(true) });
const apply = (state: EditorState, spec: ReturnType<typeof toggleWrap>) => state.update(spec).state.sliceDoc();

describe("markdown commands", () => {
  it("wraps and unwraps bold", () => {
    expect(apply(at("say hi", 4, 6), toggleWrap(at("say hi", 4, 6), "**"))).toBe("say **hi**");
    const s = at("say **hi**", 6, 8);
    expect(apply(s, toggleWrap(s, "**"))).toBe("say hi");
  });

  it("sets, swaps, and removes a line prefix on every selected line only", () => {
    const doc = "one\r\ntwo\r\nthree";
    const s = EditorState.create({ doc, selection: EditorSelection.single(0, 7), extensions: EditorState.lineSeparator.of("\r\n") });
    expect(apply(s, setLinePrefix(s, "- "))).toBe("- one\r\n- two\r\nthree");
    const h = at("- item", 2);
    expect(apply(h, setLinePrefix(h, "## "))).toBe("## item");
    const again = at("## item", 3);
    expect(apply(again, setLinePrefix(again, "## "))).toBe("item");
    const indented = at("  - nested", 5);
    expect(apply(indented, setLinePrefix(indented, "- [ ] "))).toBe("  - [ ] nested");
  });

  it("inserts a link around the selection", () => {
    const s = at("see docs", 4, 8);
    const next = s.update(insertLink(s)).state;
    expect(next.sliceDoc()).toBe("see [docs](url)");
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe("url");
  });
});
