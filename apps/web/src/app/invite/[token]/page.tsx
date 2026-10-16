import { APP_NAME } from "@gitwork/core";
import { getInvitePreview } from "@gitwork/server";
import Link from "next/link";
import { connection } from "next/server";
import { SignOutButton } from "@/components/sign-out-button";
import { Card, ROLE_LABEL } from "@/components/kit";
import { getDeps, getSession } from "@/server/context";
import { messageOf } from "@/server/pages";
import { AcceptButton } from "./accept-button";

const STATUS_TEXT = {
  accepted: "This invite was already used.",
  revoked: "This invite was cancelled.",
  expired: "This invite has expired. Ask for a new one.",
} as const;

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  await connection();
  let invite;
  try {
    invite = await getInvitePreview((await getDeps()).database.db, token);
  } catch (error) {
    return <Shell>{messageOf(error)}</Shell>;
  }
  if (invite.status !== "pending") return <Shell>{STATUS_TEXT[invite.status]}</Shell>;

  const session = await getSession();
  const path = `/invite/${token}`;
  return (
    <Shell>
      <p className="mb-6">
        You are invited to <strong>{invite.workspaceName}</strong> as <strong>{ROLE_LABEL[invite.role]}</strong>.
      </p>
      {!session ? (
        <Link
          href={`/sign-in?next=${encodeURIComponent(path)}&email=${encodeURIComponent(invite.email)}`}
          className="inline-flex h-9 w-full items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Sign in as {invite.email} to accept
        </Link>
      ) : session.user.email !== invite.email ? (
        <div className="space-y-3 text-sm">
          <p>
            This invite is for <strong>{invite.email}</strong>, but you are signed in as {session.user.email}.
          </p>
          <SignOutButton />
        </div>
      ) : (
        <AcceptButton token={token} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <h1 className="mb-4 text-xl font-semibold">Join {APP_NAME}</h1>
        <div className="text-sm">{children}</div>
      </Card>
    </main>
  );
}
