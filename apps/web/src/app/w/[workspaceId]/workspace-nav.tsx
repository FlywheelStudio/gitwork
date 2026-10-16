import Link from "next/link";
import { ROLE_LABEL } from "@/components/kit";

export function WorkspaceNav({ id, name, role }: { id: string; name: string; role: string }) {
  return (
    <div className="mb-6 flex items-end justify-between border-b border-border pb-3">
      <div>
        <h1 className="text-xl font-semibold">{name}</h1>
        <p className="text-sm text-muted-foreground">Your role: {ROLE_LABEL[role]}</p>
      </div>
      <nav className="flex gap-4 text-sm">
        <Link href={`/w/${id}`} className="hover:underline">
          Tasks
        </Link>
        <Link href={`/w/${id}/members`} className="hover:underline">
          Members
        </Link>
        {(role === "owner" || role === "admin") && (
          <Link href={`/w/${id}/settings`} className="hover:underline">
            Settings
          </Link>
        )}
      </nav>
    </div>
  );
}
