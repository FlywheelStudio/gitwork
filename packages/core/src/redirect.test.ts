import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./redirect";

const ORIGIN = "https://gitwork.example";

describe("safeRedirectPath", () => {
  it.each([
    ["/w/123/members", "/w/123/members"],
    ["/invite/abc?x=1#y", "/invite/abc?x=1#y"],
  ])("keeps same-site path %s", (input, expected) => {
    expect(safeRedirectPath(input, ORIGIN)).toBe(expected);
  });

  it.each(["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "javascript:alert(1)", "evil.com", "", null])(
    "rejects %s",
    (input) => {
      expect(safeRedirectPath(input as string | null, ORIGIN)).toBe("/");
    },
  );

  it("keeps an encoded backslash as a path segment, not a host", () => {
    expect(safeRedirectPath("/%5Cevil.com", ORIGIN)).toBe("/%5Cevil.com");
  });
});
