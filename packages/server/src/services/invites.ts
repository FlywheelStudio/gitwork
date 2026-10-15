import { APP_NAME, type Role, invitableRoles } from "@gitwork/core";
import { type Db, invites, users, workspaceMembers, workspaces } from "@gitwork/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { newId, randomToken, sha256Hex } from "../crypto";
import type { EmailMessage } from "../email";
import { ServiceError, badRequest, conflict, forbidden, notFound } from "../errors";
import { type WorkspaceAccess, requireCapability } from "./access";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw badRequest("Enter a valid email address.");
  return email;
}

/** Valid = not accepted, not revoked, not expired. Every write that uses an invite repeats this. */
const pending = (now: Date) =>
  and(isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, now));

/**
 * Creates an invite and returns the raw token (only its hash is stored). Re-inviting the same
 * email revokes the earlier pending invite in the same batch.
 */
export async function createInvite(
  db: Db,
  access: WorkspaceAccess,
  input: { email: string; role: Role },
  now = new Date(),
): Promise<{ inviteId: string; token: string; email: string; expiresAt: Date }> {
  requireCapability(access, "members.invite");
  if (!invitableRoles(access.role).includes(input.role)) throw forbidden("role_too_high", "You cannot invite with that role.");
  const email = normalizeEmail(input.email);
  const [existing] = await db
    .select({ userId: users.id })
    .from(users)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .where(and(eq(users.email, email), eq(workspaceMembers.workspaceId, access.workspace.id)))
    .limit(1);
  if (existing) throw conflict("already_member", "That person is already a member.");

  const token = randomToken();
  const inviteId = newId();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  await db.batch([
    db
      .update(invites)
      .set({ revokedAt: now })
      .where(and(eq(invites.workspaceId, access.workspace.id), eq(invites.email, email), pending(now))),
    db.insert(invites).values({
      id: inviteId,
      workspaceId: access.workspace.id,
      email,
      role: input.role,
      tokenHash: await sha256Hex(token),
      invitedBy: access.userId,
      expiresAt,
    }),
  ]);
  return { inviteId, token, email, expiresAt };
}

export async function listInvites(db: Db, access: WorkspaceAccess, now = new Date()) {
  requireCapability(access, "members.invite");
  return db
    .select({ id: invites.id, email: invites.email, role: invites.role, expiresAt: invites.expiresAt, createdAt: invites.createdAt })
    .from(invites)
    .where(and(eq(invites.workspaceId, access.workspace.id), pending(now)));
}

export async function revokeInvite(db: Db, access: WorkspaceAccess, inviteId: string, now = new Date()): Promise<void> {
  requireCapability(access, "members.invite");
  const [invite] = await db
    .select({ role: invites.role })
    .from(invites)
    .where(and(eq(invites.id, inviteId), eq(invites.workspaceId, access.workspace.id), pending(now)))
    .limit(1);
  if (!invite) throw notFound("Invite not found.");
  if (!invitableRoles(access.role).includes(invite.role)) throw forbidden();
  await db
    .update(invites)
    .set({ revokedAt: now })
    .where(and(eq(invites.id, inviteId), pending(now)));
}

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

/** What the invite page shows. Anyone holding the token may see it. */
export async function getInvitePreview(db: Db, token: string, now = new Date()) {
  const [row] = await db
    .select({
      email: invites.email,
      role: invites.role,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
      revokedAt: invites.revokedAt,
      workspaceId: invites.workspaceId,
      workspaceName: workspaces.name,
    })
    .from(invites)
    .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
    .where(eq(invites.tokenHash, await sha256Hex(token)))
    .limit(1);
  if (!row) throw notFound("This invite link is not valid.");
  const status: InviteStatus = row.acceptedAt
    ? "accepted"
    : row.revokedAt
      ? "revoked"
      : row.expiresAt <= now
        ? "expired"
        : "pending";
  return { email: row.email, role: row.role, workspaceId: row.workspaceId, workspaceName: row.workspaceName, status };
}

/**
 * Accepts an invite for the signed-in user. A batch is all-or-nothing on errors, not conditional,
 * so the membership INSERT carries the invite guard itself (INSERT … SELECT … WHERE pending). The
 * role comes from the invite row. Idempotent: accepting twice returns the same membership.
 */
export async function acceptInvite(
  db: Db,
  input: { token: string; userId: string; userEmail: string },
  now = new Date(),
): Promise<{ workspaceId: string }> {
  const tokenHash = await sha256Hex(input.token);
  const email = input.userEmail.toLowerCase();
  const guard = and(eq(invites.tokenHash, tokenHash), eq(invites.email, email), pending(now));
  await db.batch([
    db
      .insert(workspaceMembers)
      .select(
        db
          .select({
            workspaceId: invites.workspaceId,
            userId: sql<string>`${input.userId}`.as("user_id"),
            role: invites.role,
            createdAt: sql<Date>`${now.getTime()}`.as("created_at"),
          })
          .from(invites)
          .where(guard),
      )
      .onConflictDoNothing(),
    db.update(invites).set({ acceptedAt: now, acceptedBy: input.userId }).where(guard),
  ]);

  const [invite] = await db
    .select({
      workspaceId: invites.workspaceId,
      email: invites.email,
      acceptedBy: invites.acceptedBy,
      revokedAt: invites.revokedAt,
      expiresAt: invites.expiresAt,
    })
    .from(invites)
    .where(eq(invites.tokenHash, tokenHash))
    .limit(1);
  if (!invite) throw notFound("This invite link is not valid.");
  if (invite.acceptedBy === input.userId) return { workspaceId: invite.workspaceId };
  if (invite.email !== email) {
    throw forbidden("wrong_email", `This invite is for ${invite.email}. Sign in with that email to accept it.`);
  }
  if (invite.acceptedBy) throw conflict("already_accepted", "This invite was already used.");
  if (invite.revokedAt) throw new ServiceError(410, "revoked", "This invite was cancelled.");
  throw new ServiceError(410, "expired", "This invite has expired. Ask for a new one.");
}

export function inviteEmail(input: {
  baseURL: string;
  to: string;
  token: string;
  workspaceName: string;
  inviterName: string;
}): EmailMessage {
  const link = `${input.baseURL.replace(/\/$/, "")}/invite/${input.token}`;
  const subject = `${input.inviterName} invited you to ${input.workspaceName} on ${APP_NAME}`;
  const text = `${subject}.\n\nOpen this link to accept: ${link}\n\nThe invite expires in 7 days.`;
  const html = `<p>${escapeHtml(subject)}.</p><p><a href="${escapeHtml(link)}">Accept the invite</a></p><p style="color:#666">The invite expires in 7 days.</p>`;
  return { to: input.to, subject, text, html };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
