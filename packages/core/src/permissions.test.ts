import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  type Capability,
  GITHUB_CAPABILITIES,
  ROLES,
  type Role,
  authorize,
  can,
  canManageMember,
  effectiveRole,
  invitableRoles,
} from "./permissions";

// The matrix from docs/spec.md → Roles, written out by hand. It must not be derived from the code.
// o = owner, a = admin, m = member, r = read_only. "s" = Read Only only with the setting on.
const SPEC: Record<Capability, string> = {
  "workspace.view": "oamr",
  "items.view_hidden": "oam",
  "drafts.view": "oams",
  "comments.create": "oams",
  "tasks.write": "oam",
  "docs.write": "oam",
  "docs.delete": "oa",
  "members.invite": "oa",
  "members.manage": "oa",
  "workspace.settings": "oa",
  "workspace.github_settings": "oa",
  "github.install_app": "oa",
  "admins.manage": "o",
  "workspace.delete": "o",
  "audit.view_full": "oa",
};
const LETTER: Record<Role, string> = { owner: "o", admin: "a", member: "m", read_only: "r" };
const SETTING_FOR: Partial<Record<Capability, "readOnlyCanComment" | "showDraftsToReadOnly">> = {
  "comments.create": "readOnlyCanComment",
  "drafts.view": "showDraftsToReadOnly",
};
const OFF = { readOnlyCanComment: false, showDraftsToReadOnly: false };
const ON = { readOnlyCanComment: true, showDraftsToReadOnly: true };

describe("role matrix", () => {
  it("covers every capability", () => {
    expect(Object.keys(SPEC).sort()).toEqual([...CAPABILITIES].sort());
  });

  for (const capability of CAPABILITIES) {
    for (const role of ROLES) {
      const expected = SPEC[capability].includes(LETTER[role]);
      it(`${role} ${expected ? "can" : "cannot"} ${capability} (GitHub linked, settings off)`, () => {
        expect(can({ role, hasGitHub: true }, capability, OFF)).toBe(expected);
      });
    }
  }

  for (const [capability, setting] of Object.entries(SETTING_FOR) as [Capability, string][]) {
    it(`read_only can ${capability} only when ${setting} is on`, () => {
      expect(can({ role: "read_only", hasGitHub: false }, capability, OFF)).toBe(false);
      expect(can({ role: "read_only", hasGitHub: false }, capability, { ...OFF, [setting]: true })).toBe(true);
    });
  }

  it("settings never widen anything else for read_only", () => {
    for (const capability of CAPABILITIES) {
      if (capability in SETTING_FOR) continue;
      expect(can({ role: "read_only", hasGitHub: true }, capability, ON)).toBe(SPEC[capability].includes("r"));
    }
  });
});

describe("GitHub gate (decision 017)", () => {
  it("gates exactly the GitHub tasks", () => {
    expect([...GITHUB_CAPABILITIES].sort()).toEqual(["github.install_app", "workspace.github_settings"]);
  });

  for (const role of ["owner", "admin"] as const) {
    it(`${role} without GitHub cannot do GitHub tasks, and gets the link reason`, () => {
      for (const capability of GITHUB_CAPABILITIES) {
        expect(authorize({ role, hasGitHub: false }, capability)).toEqual({ ok: false, reason: "github_link_required" });
      }
    });

    it(`${role} without GitHub keeps every other capability`, () => {
      for (const capability of CAPABILITIES) {
        if (GITHUB_CAPABILITIES.has(capability)) continue;
        expect(can({ role, hasGitHub: false }, capability, OFF)).toBe(SPEC[capability].includes(LETTER[role]));
      }
    });
  }

  it("reports role, not GitHub, when the role itself is not allowed", () => {
    expect(authorize({ role: "member", hasGitHub: false }, "github.install_app")).toEqual({ ok: false, reason: "role" });
  });
});

describe("effectiveRole", () => {
  it("makes Account Owners Owner in every workspace", () => {
    expect(effectiveRole({ memberRole: null, isAccountOwner: true })).toBe("owner");
    expect(effectiveRole({ memberRole: "read_only", isAccountOwner: true })).toBe("owner");
  });

  it("uses the membership role otherwise, and null means no access", () => {
    expect(effectiveRole({ memberRole: "member", isAccountOwner: false })).toBe("member");
    expect(effectiveRole({ memberRole: null, isAccountOwner: false })).toBeNull();
  });
});

describe("invitableRoles", () => {
  it("lets Owners grant any role and Admins up to Member", () => {
    expect([...invitableRoles("owner")].sort()).toEqual([...ROLES].sort());
    expect([...invitableRoles("admin")].sort()).toEqual(["member", "read_only"]);
    expect(invitableRoles("member")).toEqual([]);
    expect(invitableRoles("read_only")).toEqual([]);
  });
});

describe("canManageMember", () => {
  const owner = { role: "owner" as const, hasGitHub: false };
  const admin = { role: "admin" as const, hasGitHub: false };
  const member = { role: "member" as const, hasGitHub: true };

  it("lets an Admin move people between Member and Read Only, and remove them", () => {
    expect(canManageMember(admin, "member", "read_only")).toBe(true);
    expect(canManageMember(admin, "read_only", null)).toBe(true);
  });

  it("stops an Admin from promoting to Admin or touching Admins and Owners", () => {
    expect(canManageMember(admin, "member", "admin")).toBe(false);
    expect(canManageMember(admin, "admin", "member")).toBe(false);
    expect(canManageMember(admin, "owner", null)).toBe(false);
  });

  it("lets an Owner manage anyone", () => {
    expect(canManageMember(owner, "admin", "member")).toBe(true);
    expect(canManageMember(owner, "owner", null)).toBe(true);
  });

  it("stops Members", () => {
    expect(canManageMember(member, "read_only", null)).toBe(false);
  });
});
