import { confirmInstallation } from "@gitwork/server";
import Link from "next/link";
import { Header } from "@/components/header";
import { Card } from "@/components/kit";
import { getDeps } from "@/server/context";
import { requireUser } from "@/server/pages";

/**
 * GitHub sends people here after installing the App. The installation_id in the URL is not
 * trusted: the server asks GitHub about it with the App's own credentials first.
 */
export default async function Installed({ searchParams }: PageProps<"/github/installed">) {
  const user = await requireUser("/");
  const { installation_id } = await searchParams;
  const deps = await getDeps();
  let message = "The GitHub App is installed. Repositories appear as GitHub sends them.";
  const id = Number(installation_id);
  if (deps.github && Number.isInteger(id) && id > 0) {
    try {
      // The id comes from the URL, so do not echo which org it belongs to.
      await confirmInstallation(deps.database.db, deps.github.client, id);
      message = "Installation confirmed. You can now connect its repos and boards to a workspace.";
    } catch {
      message = "We could not confirm this installation with GitHub. If you just installed the App, try again in a minute.";
    }
  }
  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <Card>
          <h1 className="mb-2 text-xl font-semibold">GitHub</h1>
          <p className="mb-4 text-sm">{message}</p>
          <Link href="/" className="text-sm underline">
            Back to workspaces
          </Link>
        </Card>
      </main>
    </>
  );
}
