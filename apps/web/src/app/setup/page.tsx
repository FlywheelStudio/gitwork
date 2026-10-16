import { getSignupPolicy } from "@gitwork/server";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { Card } from "@/components/ui";
import { getDeps, isAdmin } from "@/server/context";
import { requireUser } from "@/server/pages";
import { CreateAppForm } from "./create-app-form";
import { ReplaceAppButton } from "./replace-app-button";
import { SignupPolicy } from "./signup-policy";

const ERRORS: Record<string, string> = {
  invalid_state: "That setup link expired or was already used. Start again.",
  app_exists: "A GitHub App is already set up for this instance.",
  conversion_failed: "GitHub did not accept the setup code. Start again.",
};

export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  const user = await requireUser("/setup");
  if (!isAdmin(user.email)) notFound();
  const { error } = await searchParams;
  const deps = await getDeps();
  const app = deps.github?.app;
  const signups = await getSignupPolicy(deps.database.db);

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-6">
        <h1 className="text-xl font-semibold">Instance setup</h1>
        {typeof error === "string" && <p role="alert" className="text-sm text-red-600">{ERRORS[error] ?? "Setup failed."}</p>}

        <Card>
          <h2 className="mb-1 font-medium">1. Email</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Working: you signed in with an emailed code.</p>
        </Card>

        <Card>
          <h2 className="mb-1 font-medium">2. GitHub App</h2>
          {deps.githubError === "undecryptable" ? (
            <div className="space-y-3 text-sm">
              <p role="alert" className="text-red-600">
                The stored GitHub App credentials cannot be decrypted. BETTER_AUTH_SECRET probably changed. Replace the App
                here, then delete the old one on GitHub.
              </p>
              <ReplaceAppButton />
            </div>
          ) : app ? (
            <p className="text-sm">
              Connected:{" "}
              <a className="underline" href={app.htmlUrl || `https://github.com/apps/${app.slug}`}>
                {app.slug || app.appId}
              </a>
              {app.source === "env" && " (from environment variables)"}.
            </p>
          ) : (
            <>
              <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
                Creates a private GitHub App for this instance with the right permissions and webhooks. GitHub asks you to
                confirm, then sends you back here. GitHub must be able to reach this instance&apos;s URL for webhooks.
              </p>
              <CreateAppForm />
            </>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 font-medium">3. Who can create an account</h2>
          <SignupPolicy initial={signups} />
          <p className="mt-2 text-sm text-zinc-500">People with an invite can always join.</p>
        </Card>
      </main>
    </>
  );
}
