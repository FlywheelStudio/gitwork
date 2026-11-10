// Runs once per server start, before requests. Node: config check, migrations (Docker), the
// reconcile timer. A no-op in the Worker build.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootNode, startScheduler } = await import("@/server/runtime");
  await bootNode();
  startScheduler();
}
