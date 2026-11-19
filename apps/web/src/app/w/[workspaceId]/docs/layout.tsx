import { can } from "@gitwork/core";
import { listDocs } from "@gitwork/server";
import { requireWorkspacePage } from "@/server/pages";
import { DocsTree } from "./docs-tree";

/** The doc tree beside every doc. Reads the cache only; GitHub is never called from a render. */
export default async function DocsLayout({ children, params }: LayoutProps<"/w/[workspaceId]/docs">) {
  const { workspaceId } = await params;
  const { access, db } = await requireWorkspacePage(workspaceId, `/w/${workspaceId}/docs`);
  const docs = await listDocs(db, access);
  return (
    <div className="flex min-h-full flex-col gap-4 md:flex-row md:gap-6">
      <DocsTree workspaceId={workspaceId} linked={docs.linked} repos={docs.repos} canWrite={can(access.actor, "docs.write", access.settings)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
