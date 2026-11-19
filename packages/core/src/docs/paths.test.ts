import { describe, expect, it } from "vitest";
import { imageType, isUnderRoot, normalizeDocPath, normalizeRoot, relativeLink, resolveRelative, safeFileName } from "./paths";
import { docVisibilityContext, isDocVisible } from "../visibility";

describe("doc paths", () => {
  it("accepts clean repo-relative paths", () => {
    expect(normalizeDocPath("docs/a/b.md")).toBe("docs/a/b.md");
    expect(normalizeDocPath("docs/Ünïcode file.md")).toBe("docs/Ünïcode file.md");
  });

  it.each(["", "/docs/a.md", "docs/a.md/", "docs//a.md", "docs/../x.md", "docs/./a.md", "docs\\a.md", "docs/a\u0000.md", ".git/config", "docs/ a.md", "x".repeat(401)])(
    "rejects %j",
    (p) => expect(normalizeDocPath(p)).toBeNull(),
  );

  it("normalizes a docs folder setting", () => {
    expect(normalizeRoot("/docs/")).toBe("docs");
    expect(normalizeRoot(" handbook/guides ")).toBe("handbook/guides");
    expect(normalizeRoot("/")).toBeNull();
    expect(normalizeRoot("../x")).toBeNull();
  });

  it("checks the root by whole segments", () => {
    expect(isUnderRoot("docs/a.md", "docs")).toBe(true);
    expect(isUnderRoot("docs-old/a.md", "docs")).toBe(false);
    expect(isUnderRoot("docs", "docs")).toBe(false);
  });

  it("resolves links against the doc's folder and refuses escapes", () => {
    expect(resolveRelative("docs/guide/a.md", "img/x.png")).toBe("docs/guide/img/x.png");
    expect(resolveRelative("docs/guide/a.md", "../assets/x%20y.png?raw=1#top")).toBe("docs/assets/x y.png");
    expect(resolveRelative("docs/a.md", "./b.md")).toBe("docs/b.md");
    expect(resolveRelative("docs/a.md", "../../../etc/passwd")).toBeNull();
    expect(resolveRelative("docs/a.md", "https://example.com/x.png")).toBeNull();
    expect(resolveRelative("docs/a.md", "/abs.png")).toBeNull();
    expect(resolveRelative("docs/a.md", "#heading")).toBeNull();
    expect(resolveRelative("docs/a.md", "javascript:alert(1)")).toBeNull();
    expect(resolveRelative("docs/a.md", "%E0%A4%A")).toBeNull();
  });

  it("makes relative links that resolve back to the same file", () => {
    expect(relativeLink("docs/guide/a.md", "docs/assets/x.png")).toBe("../assets/x.png");
    expect(relativeLink("docs/a.md", "docs/assets/my shot.png")).toBe("assets/my%20shot.png");
    expect(relativeLink("docs/a.md", "docs/x (1).png")).toBe("x%20%281%29.png");
    expect(relativeLink("docs/a/b/c.md", "docs/a/b/d.png")).toBe("d.png");
    for (const [from, to] of [["docs/guide/a.md", "docs/assets/x (1).png"], ["docs/a.md", "docs/a/b.png"], ["docs/x/y/z.md", "docs/q.png"]] as const) {
      expect(resolveRelative(from, relativeLink(from, to))).toBe(to);
    }
  });

  it("knows image types and makes safe upload names", () => {
    expect(imageType("a/B.PNG")).toBe("image/png");
    expect(imageType("a/b.svg")).toBe("image/svg+xml");
    expect(imageType("a/b.pdf")).toBeNull();
    expect(safeFileName("Screen Shot 2026-11-19 at 10.00.png")).toBe("screen-shot-2026-11-19-at-10.00.png");
    expect(safeFileName("../../evil.PNG")).toBe("evil.png");
    expect(safeFileName("???.png")).toBe("image.png");
  });
});

describe("isDocVisible", () => {
  const reader = docVisibilityContext({ role: "read_only", hasGitHub: false }, { readOnlyCanComment: false, showDraftsToReadOnly: false }, "/Internal/");
  const member = docVisibilityContext({ role: "member", hasGitHub: false }, { readOnlyCanComment: false, showDraftsToReadOnly: false }, "internal");

  it("hides the hide folder from Read Only, without case, and only whole segments", () => {
    expect(isDocVisible("docs/internal/plan.md", "docs", reader)).toBe(false);
    expect(isDocVisible("docs/INTERNAL/plan.md", "docs", reader)).toBe(false);
    expect(isDocVisible("docs/internal", "docs", reader)).toBe(false);
    expect(isDocVisible("docs/internal-notes.md", "docs", reader)).toBe(true);
    expect(isDocVisible("docs/a/internal/x.md", "docs", reader)).toBe(true);
  });

  it("shows the hide folder to Members", () => {
    expect(isDocVisible("docs/internal/plan.md", "docs", member)).toBe(true);
  });

  it("never shows files outside the docs folder", () => {
    expect(isDocVisible("README.md", "docs", member)).toBe(false);
    expect(isDocVisible("docs-old/a.md", "docs", member)).toBe(false);
  });

  it("hides nothing when no folder is set", () => {
    const open = docVisibilityContext({ role: "read_only", hasGitHub: false }, { readOnlyCanComment: false, showDraftsToReadOnly: false }, "  ");
    expect(isDocVisible("docs/internal/plan.md", "docs", open)).toBe(true);
  });
});
