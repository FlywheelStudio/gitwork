import { can, invitableRoles } from "@gitwork/core";
import { listInvites, listMembers } from "@gitwork/server";
import { requireWorkspacePage } from "@/server/pages";
import { MembersPanel } from "./members-panel";

export default async function MembersPage({ params }: PageProps<"/w/[workspaceId]/members">) {
  const { workspaceId } = await params;
  const { user, access, db } = await requireWorkspacePage(workspaceId, `/w/${workspaceId}/members`);
  const canInvite = can(access.actor, "members.invite", access.settings);
  const [members, invites] = await Promise.all([listMembers(db, access), canInvite ? listInvites(db, access) : []]);

  return (
    <>
      <div className="mx-auto w-full max-w-4xl">
        <MembersPanel
          workspaceId={workspaceId}
          currentUserId={user.id}
          members={members}
          invites={invites.map((i) => ({ id: i.id, email: i.email, role: i.role }))}
          grantable={canInvite ? [...invitableRoles(access.role)] : []}
        />
      </div>
    </>
  );
}
