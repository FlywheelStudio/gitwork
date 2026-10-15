import { listMyWorkspaces } from "@gitwork/server";
import Link from "next/link";
import { Header } from "@/components/header";
import { ROLE_LABEL } from "@/components/ui";
import { getDeps, isAdmin } from "@/server/context";
import { requireUser } from "@/server/pages";
import { Onboarding } from "./onboarding";

export default async function Home() {
  const user = await requireUser("/");
  const deps = await getDeps();
  const workspaces = await listMyWorkspaces(deps.database.db, user.id);
  const needsSetup = isAdmin(user.email) && !deps.github;

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-6">
        {needsSetup && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
            This instance has no GitHub App yet. <Link href="/setup" className="font-medium underline">Finish setup</Link>
          </p>
        )}
        {workspaces.length === 0 ? (
          <Onboarding />
        ) : (
          <>
            <h1 className="mb-4 text-xl font-semibold">Workspaces</h1>
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {workspaces.map((w) => (
                <li key={w.id}>
                  <Link href={`/w/${w.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <span>
                      <span className="font-medium">{w.name}</span>
                      <span className="ml-2 text-sm text-zinc-500">{w.accountName}</span>
                    </span>
                    <span className="text-sm text-zinc-500">{ROLE_LABEL[w.role]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </>
  );
}
