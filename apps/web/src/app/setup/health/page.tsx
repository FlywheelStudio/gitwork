import { instanceHealth } from "@gitwork/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Header } from "@/components/header";
import { Card } from "@/components/kit";
import { getDeps, getConfig, isAdmin } from "@/server/context";
import { requireUser } from "@/server/pages";
import { RUNTIME } from "@/server/runtime";

function Row({ ok, label, children }: { ok: boolean | null; label: string; children: ReactNode }) {
  const mark = ok === null ? "–" : ok ? "✓" : "✗";
  const color = ok === null ? "text-muted-foreground" : ok ? "text-green-600" : "text-red-600";
  return (
    <li className="flex gap-3 py-2 text-sm" data-testid="health-row">
      <span aria-hidden className={`w-4 font-semibold ${color}`}>
        {mark}
      </span>
      <span className="w-40 shrink-0 font-medium">{label}</span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  );
}

const ago = (date: Date) => {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  return minutes < 1 ? "just now" : minutes < 120 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
};

/** Reconcile runs every 15 minutes; three missed runs is a problem. */
const isRecent = (date: Date, minutes: number) => Date.now() - date.getTime() < minutes * 60_000;

/** Instance admins only: one line per check, from the database and the environment. No GitHub calls. */
export default async function HealthPage() {
  const user = await requireUser("/setup/health");
  if (!isAdmin(user.email)) notFound();
  const deps = await getDeps();
  const health = await instanceHealth(deps.database, getConfig().env, RUNTIME);
  const errors = health.issues.filter((i) => i.level === "error");
  const reconcile = health.lastReconcile;
  const reconcileAt = reconcile ? new Date(reconcile.at) : null;
  const reconcileFresh = reconcileAt ? isRecent(reconcileAt, 45) : false;

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">Instance health</h1>
          <Link href="/setup" className="text-sm underline">
            Setup
          </Link>
        </div>
        <Card>
          <ul className="divide-y divide-foreground/5">
            <Row ok={null} label="Version">
              {process.env.GITWORK_VERSION || "dev"} · {RUNTIME === "node" ? "Node" : "Cloudflare Workers"} · database{" "}
              {health.driver}
            </Row>
            <Row ok={errors.length === 0} label="Configuration">
              {health.issues.length === 0 ? "No problems." : `${errors.length} errors, ${health.issues.length - errors.length} warnings (below).`}
            </Row>
            <Row ok={deps.github ? true : deps.githubError ? false : null} label="GitHub App">
              {deps.github
                ? `${deps.github.app.slug || deps.github.app.appId} (${deps.github.app.source === "env" ? "environment" : "created in setup"})`
                : deps.githubError
                  ? "Stored credentials cannot be decrypted. Re-run setup."
                  : "Not set up yet."}
            </Row>
            <Row ok={health.installations > 0 ? true : null} label="Installations">
              {health.installations === 0 ? "None yet." : `${health.installations} organization(s).`}
            </Row>
            <Row ok={health.lastWebhookAt ? true : null} label="Last webhook">
              {health.lastWebhookAt ? ago(health.lastWebhookAt) : "None received yet. GitHub must reach this instance's URL."}
            </Row>
            <Row ok={reconcile ? reconcile.status !== "error" && reconcileFresh : null} label="Last reconcile">
              {reconcile && reconcileAt
                ? `${ago(reconcileAt)}: ${reconcile.status}${reconcile.message ? ` (${reconcile.message})` : ""}`
                : "Not run yet. It runs every 15 minutes."}
            </Row>
          </ul>
        </Card>
        {health.issues.length > 0 && (
          <Card>
            <h2 className="mb-2 font-medium">Configuration problems</h2>
            <ul className="space-y-2 text-sm" data-testid="config-issues">
              {health.issues.map((issue) => (
                <li key={issue.key + issue.message}>
                  <span className={issue.level === "error" ? "font-medium text-red-600" : "font-medium text-amber-600"}>
                    {issue.level === "error" ? "Error" : "Warning"}
                  </span>{" "}
                  <code>{issue.key}</code>: {issue.message}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted-foreground">Change the environment variables, then restart. See .env.example.</p>
          </Card>
        )}
      </main>
    </>
  );
}
