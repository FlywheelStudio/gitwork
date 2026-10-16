/**
 * Which board items a viewer may receive (decisions 006, 012). Fail-closed: an item is visible
 * only when one rule below lets it through. Every task response passes through `isTaskVisible`.
 */
import { type Actor, type PermissionSettings, can } from "./permissions";

export interface VisibilityContext {
  /** `items.view_hidden`: may see issues with the hide label. */
  canViewHidden: boolean;
  /** `drafts.view`: may see draft items (no repo, no labels). */
  canViewDrafts: boolean;
  /** The workspace's hide label, or null when nothing is hidden. */
  hideLabel: string | null;
  /** The workspace's linked repos that the App can still reach. */
  repoNodeIds: ReadonlySet<string>;
}

export function visibilityContext(
  actor: Actor,
  settings: PermissionSettings,
  hideLabel: string | null,
  repoNodeIds: Iterable<string>,
): VisibilityContext {
  return {
    canViewHidden: can(actor, "items.view_hidden", settings),
    canViewDrafts: can(actor, "drafts.view", settings),
    hideLabel: hideLabel?.trim() || null,
    repoNodeIds: new Set(repoNodeIds),
  };
}

/** The facts the filter needs about one board item and its issue. */
export interface ItemFacts {
  contentType: string;
  deleted: boolean;
  archived: boolean;
  /** The cached issue behind an ISSUE item, or null when it is not in the cache. */
  issue: { repoNodeId: string; deleted: boolean; labels: readonly { name: string }[] } | null;
}

/** GitHub label names are case-insensitive. */
export function hasHideLabel(labels: readonly { name: string }[], hideLabel: string | null): boolean {
  if (!hideLabel) return false;
  const wanted = hideLabel.toLowerCase();
  return labels.some((l) => l.name.toLowerCase() === wanted);
}

export function isTaskVisible(item: ItemFacts, ctx: VisibilityContext): boolean {
  if (item.deleted || item.archived) return false;
  if (item.contentType === "DRAFT_ISSUE") return ctx.canViewDrafts;
  if (item.contentType !== "ISSUE") return false; // pull requests, redacted items, anything new
  const issue = item.issue;
  if (!issue || issue.deleted) return false;
  if (!ctx.repoNodeIds.has(issue.repoNodeId)) return false;
  if (!ctx.canViewHidden && hasHideLabel(issue.labels, ctx.hideLabel)) return false;
  return true;
}
