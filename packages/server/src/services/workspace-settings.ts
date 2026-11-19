/** Per-workspace switches: hide label and folder (012), review mode (008), Read Only drafts and comments (006, 007). */
import { normalizeRoot } from "@gitwork/core";
import { type Db, workspaces } from "@gitwork/db";
import { eq } from "drizzle-orm";
import { badRequest } from "../errors";
import { auditInsert } from "./audit";
import { type WorkspaceAccess, requireCapability } from "./access";

export interface WorkspaceSettingsInput {
  hideLabel?: string | null;
  hideFolder?: string | null;
  reviewBotDocEdits?: boolean;
  showDraftsToReadOnly?: boolean;
  readOnlyCanComment?: boolean;
}

export async function updateWorkspaceSettings(db: Db, access: WorkspaceAccess, input: WorkspaceSettingsInput, now = new Date()) {
  requireCapability(access, "workspace.settings");
  const set: WorkspaceSettingsInput = {};
  if (input.hideLabel !== undefined) {
    const label = input.hideLabel?.trim() || null;
    // GitHub's label name limit.
    if (label && label.length > 50) throw badRequest("Label names are at most 50 characters.");
    set.hideLabel = label;
  }
  if (input.hideFolder !== undefined) {
    const raw = input.hideFolder?.trim() ?? "";
    // Relative to each repo's docs folder (decision 012).
    const folder = raw ? normalizeRoot(raw) : null;
    if (raw && !folder) throw badRequest("Enter a folder inside the docs folder, such as internal.");
    set.hideFolder = folder;
  }
  if (input.reviewBotDocEdits !== undefined) set.reviewBotDocEdits = input.reviewBotDocEdits;
  if (input.showDraftsToReadOnly !== undefined) set.showDraftsToReadOnly = input.showDraftsToReadOnly;
  if (input.readOnlyCanComment !== undefined) set.readOnlyCanComment = input.readOnlyCanComment;
  if (Object.keys(set).length === 0) return;
  await db.batch([
    db.update(workspaces).set(set).where(eq(workspaces.id, access.workspace.id)),
    auditInsert(db, { userId: access.userId, workspaceId: access.workspace.id, action: "workspace.settings", via: "local", target: access.workspace.id, detail: { ...set } }, now),
  ]);
}
