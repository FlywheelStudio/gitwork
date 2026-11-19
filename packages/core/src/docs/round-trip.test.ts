import { describe, expect, it } from "vitest";
import fixtures from "../../fixtures/docs/round-trip.json";
import { type FixtureCase, runOps } from "./fixtures";
import { bytesEqual, bytesToText, decodeBase64, encodeBase64, lineSeparatorOf, textToBytes } from "./text";

const cases = fixtures.cases as FixtureCase[];

/** Lines with their own line break, so a changed ending counts as a changed line. */
const linesOf = (s: string) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];

describe.each(cases)("round-trip fixture $name", (c) => {
  const bytes = c.inputBase64 ? decodeBase64(c.inputBase64) : textToBytes(c.input!);

  it("loads and saves with no edit to the same bytes (through base64, as GitHub sends them)", () => {
    const text = bytesToText(decodeBase64(encodeBase64(bytes)));
    if (c.editable === false) return expect(text).toBeNull();
    expect(text).toBe(c.input);
    expect(bytesEqual(textToBytes(text!), bytes)).toBe(true);
  });

  if (c.editable === false) return;

  it("uses the expected line separator", () => {
    expect(lineSeparatorOf(c.input!)).toBe(c.separator);
  });

  it("applies the ops and leaves untouched lines byte-identical", () => {
    const out = runOps(c.input!, c.ops ?? []);
    expect(out).toBe(c.expected);
    const before = linesOf(c.input!);
    const after = linesOf(out);
    // Lines before the first difference and after the last one are the same strings.
    let head = 0;
    while (head < before.length && head < after.length && before[head] === after[head]) head++;
    let tail = 0;
    while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
    const changedBefore = before.length - head - tail;
    // Every op touches at most a couple of lines; nothing else moved.
    expect(changedBefore).toBeLessThanOrEqual(Math.max(1, (c.ops ?? []).length * 2));
  });
});
