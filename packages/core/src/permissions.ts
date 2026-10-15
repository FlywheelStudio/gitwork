/**
 * The role matrix (docs/spec.md → Roles; decisions 007, 012, 017).
 * Pure functions over plain data. Every server read and write calls these.
 */

export const ROLES = ["owner", "admin", "member", "read_only"] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  "workspace.view", // tasks and docs, minus hidden and draft items for Read Only
  "items.view_hidden", // issues with the hide label, files under the hide folder
  "drafts.view", // Projects v2 draft items (no repo, no labels)
  "comments.create", // comments and requests
  "tasks.write", // create, edit, move
  "docs.write", // create, edit, rename, move
  "docs.delete",
  "members.invite",
  "members.manage", // change roles, remove
  "workspace.settings", // hiding, review mode, Read Only switches
  "workspace.github_settings", // repos, board, fields
  "github.install_app",
  "admins.manage",
  "workspace.delete",
  "audit.view_full",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** The only capabilities that need a linked GitHub account (decision 017). */
export const GITHUB_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  "workspace.github_settings",
  "github.install_app",
]);

/** Per-workspace switches that widen what Read Only users get. Both default to false. */
export interface PermissionSettings {
  readOnlyCanComment: boolean;
  showDraftsToReadOnly: boolean;
}

export const DEFAULT_PERMISSION_SETTINGS: PermissionSettings = {
  readOnlyCanComment: false,
  showDraftsToReadOnly: false,
};

export interface Actor {
  role: Role;
  hasGitHub: boolean;
}

type Grant = boolean | keyof PermissionSettings;

// Columns: owner, admin, member, read_only. A string grants the capability when that setting is on.
const MATRIX: Record<Capability, readonly [Grant, Grant, Grant, Grant]> = {
  "workspace.view": [true, true, true, true],
  "items.view_hidden": [true, true, true, false],
  "drafts.view": [true, true, true, "showDraftsToReadOnly"],
  "comments.create": [true, true, true, "readOnlyCanComment"],
  "tasks.write": [true, true, true, false],
  "docs.write": [true, true, true, false],
  "docs.delete": [true, true, false, false],
  "members.invite": [true, true, false, false],
  "members.manage": [true, true, false, false],
  "workspace.settings": [true, true, false, false],
  "workspace.github_settings": [true, true, false, false],
  "github.install_app": [true, true, false, false],
  "admins.manage": [true, false, false, false],
  "workspace.delete": [true, false, false, false],
  "audit.view_full": [true, true, false, false],
};

export type Decision = { ok: true } | { ok: false; reason: "role" | "github_link_required" };

export function authorize(
  actor: Actor,
  capability: Capability,
  settings: PermissionSettings = DEFAULT_PERMISSION_SETTINGS,
): Decision {
  const grant = MATRIX[capability][ROLES.indexOf(actor.role)];
  const allowed = typeof grant === "string" ? settings[grant] : grant === true;
  if (!allowed) return { ok: false, reason: "role" };
  if (GITHUB_CAPABILITIES.has(capability) && !actor.hasGitHub) {
    return { ok: false, reason: "github_link_required" };
  }
  return { ok: true };
}

export function can(actor: Actor, capability: Capability, settings?: PermissionSettings): boolean {
  return authorize(actor, capability, settings).ok;
}

/**
 * A user's role in one workspace. Account Owners are Owner in every workspace of the account.
 * Returns null when the user has no access.
 */
export function effectiveRole(input: { memberRole: Role | null; isAccountOwner: boolean }): Role | null {
  if (input.isAccountOwner) return "owner";
  return input.memberRole;
}

/** Roles an actor may grant by invite or role change. Owner: any role. Admin: up to Member. */
export function invitableRoles(role: Role): readonly Role[] {
  switch (role) {
    case "owner":
      return ROLES;
    case "admin":
      return ["member", "read_only"];
    default:
      return [];
  }
}

/**
 * Whether `actor` may change a member from `currentRole` to `newRole`, or remove them
 * (`newRole` = null). Both roles must be within what the actor may grant.
 * The "last Owner" rule is a database guard, not checked here.
 */
export function canManageMember(actor: Actor, currentRole: Role, newRole: Role | null): boolean {
  if (!can(actor, "members.manage")) return false;
  const grantable = invitableRoles(actor.role);
  if (!grantable.includes(currentRole)) return false;
  return newRole === null || grantable.includes(newRole);
}
