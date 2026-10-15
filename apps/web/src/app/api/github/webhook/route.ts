import { handleGitHubWebhook } from "@gitwork/server";
import { getDeps } from "@/server/context";

// GitHub App webhooks (decision 010). Signature-checked inside the handler.
export async function POST(request: Request) {
  const { database, github } = await getDeps();
  if (!github) return Response.json({ error: "GitHub App is not set up" }, { status: 503 });
  return handleGitHubWebhook(request, { db: database.db, app: github.app, client: github.client });
}
