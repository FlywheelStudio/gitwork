/** The audit log (decision 008). Each helper returns one statement, for a batch. */
import { type Db, auditLog } from "@gitwork/db";
import { newId } from "../crypto";

export interface AuditEntry {
  userId: string;
  workspaceId: string;
  action: string;
  via: "user" | "app" | "local";
  repoNodeId?: string | null;
  target?: string | null;
  commitSha?: string | null;
  detail?: Record<string, unknown>;
}

export function auditInsert(db: Db, entry: AuditEntry, at = new Date()) {
  return db.insert(auditLog).values({
    id: newId(),
    at,
    userId: entry.userId,
    workspaceId: entry.workspaceId,
    action: entry.action,
    via: entry.via,
    repoNodeId: entry.repoNodeId ?? null,
    target: entry.target ?? null,
    commitSha: entry.commitSha ?? null,
    detail: entry.detail ?? null,
  });
}
