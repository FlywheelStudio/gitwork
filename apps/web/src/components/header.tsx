import { APP_NAME } from "@gitwork/core";
import Link from "next/link";
import { SignOutButton } from "./sign-out-button";

export function Header({ email }: { email: string }) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
      <Link href="/" className="font-semibold">
        {APP_NAME}
      </Link>
      <div className="flex items-center gap-3 text-sm">
        <Link href="/settings" className="text-zinc-600 hover:underline dark:text-zinc-400">
          {email}
        </Link>
        <SignOutButton />
      </div>
    </header>
  );
}
