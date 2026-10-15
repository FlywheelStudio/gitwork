import Link from "next/link";
import { ROLE_LABEL } from "@/components/ui";

export function WorkspaceNav({ id, name, role }: { id: string; name: string; role: string }) {
  return (
    <div className="mb-6 flex items-end justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
      <div>
        <h1 className="text-xl font-semibold">{name}</h1>
        <p className="text-sm text-zinc-500">Your role: {ROLE_LABEL[role]}</p>
      </div>
      <nav className="flex gap-4 text-sm">
        <Link href={`/w/${id}`} className="hover:underline">
          Overview
        </Link>
        <Link href={`/w/${id}/members`} className="hover:underline">
          Members
        </Link>
      </nav>
    </div>
  );
}
