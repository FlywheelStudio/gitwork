import { requireWorkspacePage } from "@/server/pages";
import { decodeSegment } from "../../links";
import { DocEditor } from "../../doc-editor";

/** The editor loads the doc through /api/v1 in the browser: this render never calls GitHub. */
export default async function DocPage({ params }: PageProps<"/w/[workspaceId]/docs/[repoNodeId]/[...path]">) {
  const { workspaceId, repoNodeId, path } = await params;
  await requireWorkspacePage(workspaceId, `/w/${workspaceId}/docs`);
  const docPath = path.map(decodeSegment).join("/");
  const repo = decodeSegment(repoNodeId);
  return <DocEditor key={`${repo}:${docPath}`} workspaceId={workspaceId} repoNodeId={repo} path={docPath} />;
}
