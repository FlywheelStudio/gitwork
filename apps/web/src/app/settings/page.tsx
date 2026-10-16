import { hasLinkedGitHub } from "@gitwork/server";
import { Header } from "@/components/header";
import { Card } from "@/components/kit";
import { getDeps } from "@/server/context";
import { requireUser } from "@/server/pages";
import { LinkGitHubButton } from "./link-github";

export default async function SettingsPage() {
  const user = await requireUser("/settings");
  const deps = await getDeps();
  const linked = await hasLinkedGitHub(deps.database.db, user.id);
  const githubConfigured = deps.github !== null || deps.auth.options.socialProviders?.github !== undefined;

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <Card>
          <h2 className="mb-1 font-medium">GitHub</h2>
          <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
            Link GitHub to install the app and connect repos and boards. When linked, your edits show under
            your own GitHub name.
          </p>
          {linked ? (
            <p className="text-sm">GitHub account linked.</p>
          ) : githubConfigured ? (
            <LinkGitHubButton />
          ) : (
            <p className="text-sm text-zinc-500">GitHub linking is not set up on this instance yet.</p>
          )}
        </Card>
      </main>
    </>
  );
}
