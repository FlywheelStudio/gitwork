import { authorize } from "@gitwork/core";
import { getWorkspaceLink, installUrl } from "@gitwork/server";
import Link from "next/link";
import { Card } from "@/components/kit";
import { getDeps } from "@/server/context";
import { requireWorkspacePage } from "@/server/pages";
import { WorkspaceBoard } from "./workspace-board";

export default async function WorkspacePage({ params }: PageProps<"/w/[workspaceId]">) {
  const { workspaceId } = await params;
  const { access, db } = await requireWorkspacePage(workspaceId, `/w/${workspaceId}`);

  if (!(await getWorkspaceLink(db, workspaceId))) {
    const { github } = await getDeps();
    const install = authorize(access.actor, "github.install_app", access.settings);
    return (
      <div className="mx-auto max-w-3xl">
          <Card className="space-y-3">
            <p className="text-sm text-muted-foreground">Tasks arrive once this workspace is linked to a GitHub board and repos.</p>
            {install.ok && github && (
              <div className="flex flex-wrap gap-4 text-sm">
                <a href={installUrl(github.app)} className="font-medium underline">
                  Install the GitHub App on your organization
                </a>
                <Link href={`/w/${workspaceId}/settings`} className="font-medium underline">
                  Link a board and repos
                </Link>
              </div>
            )}
            {!install.ok && install.reason === "github_link_required" && (
              <p className="text-sm">
                <Link href="/settings" className="underline">
                  Link your GitHub account
                </Link>{" "}
                to install the GitHub App and connect repos.
              </p>
            )}
            {install.ok && !github && <p className="text-sm text-muted-foreground">The GitHub App is not set up on this instance yet.</p>}
          </Card>
      </div>
    );
  }

  return <WorkspaceBoard />;
}
