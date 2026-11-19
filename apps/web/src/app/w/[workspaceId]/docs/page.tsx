import Link from "next/link";
import { listDocs } from "@gitwork/server";
import { Card } from "@/components/kit";
import { requireWorkspacePage } from "@/server/pages";
import { docHref } from "./links";

export default async function DocsIndexPage({ params }: PageProps<"/w/[workspaceId]/docs">) {
  const { workspaceId } = await params;
  const { access, db } = await requireWorkspacePage(workspaceId, `/w/${workspaceId}/docs`);
  const docs = await listDocs(db, access);
  if (!docs.linked) {
    return (
      <Card className="mx-auto max-w-2xl">
        <p className="text-sm text-muted-foreground">
          Docs come from the <code>docs/</code> folder of each linked repo. Link this workspace to GitHub repos in{" "}
          <Link href={`/w/${workspaceId}/settings`} className="underline">
            Settings
          </Link>{" "}
          first.
        </p>
      </Card>
    );
  }
  // A README at the top of a repo first, else the first doc, so the page is never empty.
  const all = docs.repos.flatMap((r) => r.files.filter((f) => f.kind === "doc").map((f) => ({ repo: r.repoNodeId, path: f.path, root: r.root })));
  const first = all.find((d) => /^readme\.(md|markdown)$/i.test(d.root ? d.path.slice(d.root.length + 1) : d.path)) ?? all[0];
  return (
    <Card className="mx-auto max-w-2xl space-y-2">
      <h1 className="text-lg font-semibold">Docs</h1>
      <p className="text-sm text-muted-foreground">Pick a doc on the left. Every save is a commit to the repo on GitHub.</p>
      {first && (
        <p className="text-sm">
          <Link href={docHref(workspaceId, first.repo, first.path)} className="font-medium underline">
            Open {first.path}
          </Link>
        </p>
      )}
    </Card>
  );
}
