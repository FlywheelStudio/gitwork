import { authorize, can } from "@gitwork/core";
import { getWorkspaceLink, resolveMapping } from "@gitwork/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { Card } from "@/components/kit";
import { getDeps } from "@/server/context";
import { requireWorkspacePage } from "@/server/pages";
import { WorkspaceNav } from "../workspace-nav";
import { FieldMappingPanel, GitHubLinkPanel, VisibilityPanel } from "./settings-panels";

export default async function WorkspaceSettingsPage({ params }: PageProps<"/w/[workspaceId]/settings">) {
  const { workspaceId } = await params;
  const { user, access, db } = await requireWorkspacePage(workspaceId, `/w/${workspaceId}/settings`);
  const canSettings = can(access.actor, "workspace.settings", access.settings);
  const github = authorize(access.actor, "workspace.github_settings", access.settings);
  if (!canSettings && !github.ok && github.reason === "role") notFound();
  const { github: app } = await getDeps();
  const data = await getWorkspaceLink(db, workspaceId);
  const fields = data?.fields.map((f) => ({ id: f.nodeId, name: f.name, dataType: f.dataType })) ?? [];

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 p-6">
        <WorkspaceNav id={workspaceId} name={access.workspace.name} role={access.role} />
        <Card className="space-y-4">
          <h2 className="font-medium">GitHub board and repos</h2>
          {data ? (
            <div className="space-y-1 text-sm">
              <p>
                Board:{" "}
                {data.project ? (
                  <a href={data.project.url} className="font-medium hover:underline">
                    {data.project.title}
                  </a>
                ) : (
                  "unknown"
                )}
              </p>
              <p>Repos: {data.repos.map((r) => r.fullName + (r.available ? "" : " (unreachable)")).join(", ")}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not linked yet.</p>
          )}
          {!app && <p className="text-sm text-muted-foreground">The GitHub App is not set up on this instance yet.</p>}
          {app && github.ok && <GitHubLinkPanel workspaceId={workspaceId} linked={data !== null} />}
          {app && !github.ok && github.reason === "github_link_required" && (
            <p className="text-sm">
              <Link href="/settings" className="underline">
                Link your GitHub account
              </Link>{" "}
              to choose the board and repos. Only boards and repos your GitHub account can see are offered.
            </p>
          )}
        </Card>
        {data && github.ok && (
          <Card className="space-y-4">
            <h2 className="font-medium">Fields</h2>
            <FieldMappingPanel workspaceId={workspaceId} fields={fields} mapping={resolveMapping(fields, data.link)} />
          </Card>
        )}
        {canSettings && (
          <Card className="space-y-4">
            <h2 className="font-medium">What Read Only members see</h2>
            <VisibilityPanel
              workspaceId={workspaceId}
              hideLabel={access.workspace.hideLabel ?? ""}
              showDraftsToReadOnly={access.settings.showDraftsToReadOnly}
            />
          </Card>
        )}
      </main>
    </>
  );
}
