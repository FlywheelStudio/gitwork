import { describe, expect, it } from "vitest";
import { ROLES } from "./permissions";
import { type ItemFacts, hasHideLabel, isTaskVisible, visibilityContext } from "./visibility";

const OFF = { readOnlyCanComment: false, showDraftsToReadOnly: false };
const issueItem = (repo: string, labels: string[] = [], extra: Partial<ItemFacts> = {}): ItemFacts => ({
  contentType: "ISSUE",
  deleted: false,
  archived: false,
  issue: { repoNodeId: repo, deleted: false, labels: labels.map((name) => ({ name })) },
  ...extra,
});
const draft: ItemFacts = { contentType: "DRAFT_ISSUE", deleted: false, archived: false, issue: null };

function ctx(role: (typeof ROLES)[number], opts: { hideLabel?: string | null; drafts?: boolean } = {}) {
  return visibilityContext(
    { role, hasGitHub: false },
    { ...OFF, showDraftsToReadOnly: opts.drafts ?? false },
    opts.hideLabel === undefined ? "internal" : opts.hideLabel,
    ["R_linked"],
  );
}

describe("isTaskVisible", () => {
  it("shows an issue from a linked repo to every role", () => {
    for (const role of ROLES) expect(isTaskVisible(issueItem("R_linked"), ctx(role))).toBe(true);
  });

  it("never shows an issue from an unlinked repo, to any role", () => {
    for (const role of ROLES) expect(isTaskVisible(issueItem("R_other"), ctx(role))).toBe(false);
  });

  it("hides the hide label from Read Only only, ignoring case", () => {
    const item = issueItem("R_linked", ["bug", "INTERNAL"]);
    expect(isTaskVisible(item, ctx("read_only"))).toBe(false);
    for (const role of ["owner", "admin", "member"] as const) expect(isTaskVisible(item, ctx(role))).toBe(true);
  });

  it("hides nothing by label when no hide label is set", () => {
    expect(isTaskVisible(issueItem("R_linked", ["internal"]), ctx("read_only", { hideLabel: null }))).toBe(true);
    expect(isTaskVisible(issueItem("R_linked", ["internal"]), ctx("read_only", { hideLabel: "  " }))).toBe(true);
  });

  it("shows drafts to Read Only only with the setting on", () => {
    expect(isTaskVisible(draft, ctx("read_only"))).toBe(false);
    expect(isTaskVisible(draft, ctx("read_only", { drafts: true }))).toBe(true);
    expect(isTaskVisible(draft, ctx("member"))).toBe(true);
  });

  it("fails closed on anything it does not know", () => {
    const owner = ctx("owner");
    expect(isTaskVisible(issueItem("R_linked", [], { issue: null }), owner)).toBe(false);
    expect(isTaskVisible({ ...issueItem("R_linked"), issue: { repoNodeId: "R_linked", deleted: true, labels: [] } }, owner)).toBe(false);
    expect(isTaskVisible(issueItem("R_linked", [], { deleted: true }), owner)).toBe(false);
    expect(isTaskVisible(issueItem("R_linked", [], { archived: true }), owner)).toBe(false);
    for (const contentType of ["PULL_REQUEST", "REDACTED", "SOMETHING_NEW"]) {
      expect(isTaskVisible(issueItem("R_linked", [], { contentType }), owner)).toBe(false);
    }
  });
});

describe("hasHideLabel", () => {
  it("matches whole names only", () => {
    expect(hasHideLabel([{ name: "internal-ish" }], "internal")).toBe(false);
    expect(hasHideLabel([{ name: "Internal" }], "internal")).toBe(true);
  });
});
