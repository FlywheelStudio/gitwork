import { createHmac, generateKeyPairSync } from "node:crypto";
import type { Database } from "@gitwork/db";
import { GitHubClient } from "../src/github/client";
import type { GitHubAppConfig } from "../src/github/config";
import { createSecretBox } from "../src/github/crypto";
import { FakeGitHub } from "./fake-github";

const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }).toString();

export const APP: GitHubAppConfig = {
  appId: "4242",
  slug: "gitwork-test",
  clientId: "Iv1.test",
  clientSecret: "shh",
  webhookSecret: "whsec-test",
  privateKeyPem: PEM,
  htmlUrl: "https://github.com/apps/gitwork-test",
  source: "env",
};

export async function githubContext(database: Database) {
  const fake = new FakeGitHub();
  const box = await createSecretBox("test-secret");
  const client = new GitHubClient({ db: database.db, box, app: APP, fetch: fake.fetch });
  return { fake, box, client, db: database.db };
}

let counter = 0;
export function webhookRequest(event: string, payload: unknown, opts: { deliveryId?: string; secret?: string } = {}) {
  const body = JSON.stringify(payload);
  const sig = createHmac("sha256", opts.secret ?? APP.webhookSecret).update(body).digest("hex");
  return new Request("http://localhost/api/github/webhook", {
    method: "POST",
    headers: {
      "x-github-event": event,
      "x-github-delivery": opts.deliveryId ?? `delivery-${++counter}`,
      "x-hub-signature-256": `sha256=${sig}`,
      "content-type": "application/json",
    },
    body,
  });
}

export const INSTALLATION = { id: 99, account: { login: "acme", id: 7, type: "Organization" }, repository_selection: "selected" };
export const REPO = { node_id: "R_site", id: 501, name: "site", full_name: "acme/site", private: true, owner: { login: "acme" } };
