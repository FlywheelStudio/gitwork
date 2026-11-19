import { describe, expect, it } from "vitest";
import { formatValue, parseFrontmatter } from "./frontmatter";
import { offsetToEditorPos } from "./text";

describe("parseFrontmatter", () => {
  it("reads simple keys and marks complex ones read-only", () => {
    const fm = parseFrontmatter('---\ntitle: Hello\nquoted: "a \\"b\\""\nlist: [1, 2]\nnested:\n  a: 1\nnote: x # comment\nempty:\n---\nBody');
    expect(fm?.entries.map((e) => [e.key, e.value, e.editable])).toEqual([
      ["title", "Hello", true],
      ["quoted", 'a "b"', true],
      ["list", "[1, 2]", false],
      ["nested", "", false],
      ["note", "x # comment", false],
      ["empty", "", true],
    ]);
  });

  it("needs the opening line at the very top and a closing line", () => {
    expect(parseFrontmatter("\n---\na: 1\n---\n")).toBeNull();
    expect(parseFrontmatter("---\na: 1\n")).toBeNull();
    expect(parseFrontmatter("---\na: 1\n...\n")?.entries).toHaveLength(1);
  });

  it("refuses escapes it cannot round-trip", () => {
    expect(parseFrontmatter('---\na: "x\\ny"\n---\n')?.entries[0]?.editable).toBe(false);
  });
});

describe("formatValue", () => {
  it.each([
    ["plain", "plain"],
    ["two words", "two words"],
    ["a: b", '"a: b"'],
    ["#tag", '"#tag"'],
    ["- item", '"- item"'],
    ["null", '"null"'],
    ["12", '"12"'],
    [" padded", '" padded"'],
    ["", '""'],
    ['say "hi"', 'say "hi"'],
    ['"start', '"\\"start"'],
    ["line\nbreak", '"line\\nbreak"'],
  ])("%j → %s", (value, out) => expect(formatValue(value)).toBe(out));
});

describe("offsetToEditorPos", () => {
  it("counts a CRLF as one editor position", () => {
    expect(offsetToEditorPos("a\r\nb\r\nc", 6, "\r\n")).toBe(4);
    expect(offsetToEditorPos("a\r\nb", 4, "\n")).toBe(4);
  });
});
