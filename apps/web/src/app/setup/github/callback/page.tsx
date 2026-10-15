import { ServiceError, completeManifestFlow } from "@gitwork/server";
import { notFound, redirect } from "next/navigation";
import { getDeps, isAdmin } from "@/server/context";
import { requireUser } from "@/server/pages";

/** GitHub redirects here after creating the App (manifest flow). */
export default async function ManifestCallback({ searchParams }: PageProps<"/setup/github/callback">) {
  const user = await requireUser("/setup");
  if (!isAdmin(user.email)) notFound();
  const { code, state } = await searchParams;
  if (typeof code !== "string" || typeof state !== "string") redirect("/setup?error=invalid_state");
  const { database, box } = await getDeps();
  let failure: string | null = null;
  try {
    await completeManifestFlow(database.db, box!, { code, state, userId: user.id });
  } catch (error) {
    failure = error instanceof ServiceError ? error.code : "conversion_failed";
  }
  redirect(failure ? `/setup?error=${failure}` : "/setup");
}
