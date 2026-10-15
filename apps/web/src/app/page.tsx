import { APP_NAME } from "@gitwork/core";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8">
      <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">GitHub is the source of truth.</p>
    </main>
  );
}
