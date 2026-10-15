import { listMyWorkspaces } from "@gitwork/server";
import Link from "next/link";
import { Header } from "@/components/header";
import { ROLE_LABEL } from "@/components/ui";
import { getDeps } from "@/server/context";
import { requireUser } from "@/server/pages";
import { Onboarding } from "./onboarding";

export default async function Home() {
  const user = await requireUser("/");
  const workspaces = await listMyWorkspaces(getDeps().database.db, user.id);

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
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
