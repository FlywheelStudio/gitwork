import { APP_NAME } from "@gitwork/core";
import { instanceSettings } from "@gitwork/db";
import { count } from "drizzle-orm";
import { getDatabase } from "@/server/runtime";

/** Liveness plus a database round trip. Reports which driver served the request. */
export async function GET() {
  const { driver, db } = getDatabase();
  const [row] = await db.select({ settings: count() }).from(instanceSettings);
  return Response.json({ ok: true, app: APP_NAME, driver, settings: row?.settings ?? 0 });
}
