import { authorize } from "@gitwork/core";
import { installUrl } from "@gitwork/server";
import Link from "next/link";
import { Header } from "@/components/header";
import { getDeps } from "@/server/context";
import { Card } from "@/components/ui";
import { requireWorkspacePage } from "@/server/pages";
import { WorkspaceNav } from "./workspace-nav";

export default async function WorkspacePage({ params }: PageProps<"/w/[workspaceId]">) {
  const { workspaceId } = await params;
  const { user, access } = await requireWorkspacePage(workspaceId, `/w/${workspaceId}`);
  const { github } = await getDeps();
  const install = authorize(access.actor, "github.install_app", access.settings);
  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto w-full max-w-4xl flex-1 p-6">
        <WorkspaceNav id={workspaceId} name={access.workspace.name} role={access.role} />
        <Card className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Tasks and docs arrive once this workspace is linked to a GitHub board and repos.
          </p>
          {install.ok && github && (
            <a href={installUrl(github.app)} className="inline-block text-sm font-medium underline">
              Install the GitHub App on your organization
            </a>
          )}
          {!install.ok && install.reason === "github_link_required" && (
            <p className="text-sm">
              <Link href="/settings" className="underline">
                Link your GitHub account
              </Link>{" "}
              to install the GitHub App and connect repos.
            </p>
          )}
          {install.ok && !github && <p className="text-sm text-zinc-500">The GitHub App is not set up on this instance yet.</p>}
        </Card>
      </main>
    </>
  );
}
