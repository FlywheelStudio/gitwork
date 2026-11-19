import { type FixtureCase, bytesEqual, bytesToText, decodeBase64, opChange, textToBytes } from "@gitwork/core";
import fixtures from "@gitwork/core/fixtures/docs/round-trip.json";
import { describe, expect, it } from "vitest";
import { changeSpec, createDocState, docText } from "./doc-editor";

const cases = (fixtures.cases as FixtureCase[]).filter((c) => c.editable !== false);

describe.each(cases)("CodeMirror round trip: $name", (c) => {
  it("keeps the file's bytes with no edit", () => {
    const state = createDocState(c.input!);
    expect(docText(state)).toBe(c.input);
    expect(state.lineBreak).toBe(c.separator);
    expect(bytesEqual(textToBytes(docText(state)), textToBytes(c.input!))).toBe(true);
  });

  it("applies the fixture ops as editor transactions", () => {
    let state = createDocState(c.input!);
    for (const op of c.ops ?? []) {
      const change = opChange(docText(state), op);
      if (!change) continue;
      state = state.update(changeSpec(state, change)).state;
    }
    expect(docText(state)).toBe(c.expected);
  });
});

describe("typed and pasted line breaks", () => {
  it("become CRLF in a CRLF file", () => {
    const state = createDocState("a\r\nb\r\n");
    const next = state.update({ changes: { from: 1, insert: "\nx\ny" }, userEvent: "input.paste" }).state;
    expect(docText(next)).toBe("a\r\nx\r\ny\r\nb\r\n");
  });

  it("become LF in an LF file, even when pasted as CRLF", () => {
    const state = createDocState("a\nb\n");
    const next = state.update({ changes: { from: 1, insert: "\r\nx" }, userEvent: "input.paste" }).state;
    expect(docText(next)).toBe("a\nx\nb\n");
  });

  it("leave untouched mixed lines as they were", () => {
    const state = createDocState("a\r\nb\nc\r\n");
    const next = state.update({ changes: { from: state.doc.line(2).to, insert: "\nnew" }, userEvent: "input.type" }).state;
    expect(docText(next)).toBe("a\r\nb\nnew\nc\r\n");
  });
});

describe("invalid UTF-8", () => {
  it("is refused before it reaches the editor", () => {
    expect(bytesToText(decodeBase64("IyD/Cg=="))).toBeNull();
  });
});
