// Runs once per server start. Starts the Node reconcile timer; a no-op in the Worker build.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("@/server/runtime");
  startScheduler();
}
