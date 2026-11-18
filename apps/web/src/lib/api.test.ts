import { describe, expect, it } from "vitest";
import { safeNext } from "./api";

// Vitest runs in Node, where `window` is undefined, as in a server render. Regression: the sign-in
// form called safeNext during render, and `next dev` threw "window is not defined".
describe("safeNext without window", () => {
  it("keeps same-site paths and rejects off-site ones", () => {
    expect(typeof window).toBe("undefined");
    expect(safeNext("/w/abc?tab=list#x")).toBe("/w/abc?tab=list#x");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
