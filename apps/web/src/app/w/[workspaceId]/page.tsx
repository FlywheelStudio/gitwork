import { Header } from "@/components/header";
import { Card } from "@/components/ui";
import { requireWorkspacePage } from "@/server/pages";
import { WorkspaceNav } from "./workspace-nav";

export default async function WorkspacePage({ params }: PageProps<"/w/[workspaceId]">) {
  const { workspaceId } = await params;
  const { user, access } = await requireWorkspacePage(workspaceId, `/w/${workspaceId}`);
  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto w-full max-w-4xl flex-1 p-6">
        <WorkspaceNav id={workspaceId} name={access.workspace.name} role={access.role} />
        <Card>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Tasks and docs arrive once this workspace is linked to a GitHub board and repos.
          </p>
        </Card>
      </main>
    </>
  );
}
