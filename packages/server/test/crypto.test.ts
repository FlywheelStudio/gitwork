import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";
import {
  SecretBoxError,
  createAppJwt,
  createSecretBox,
  importAppPrivateKey,
  verifyWebhookSignature,
} from "../src/github/crypto";

// The manifest flow returns PKCS#1 ("BEGIN RSA PRIVATE KEY"); test both encodings.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PKCS1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const PKCS8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const WEBHOOK_SECRET = "whsec-test";
const BODY = JSON.stringify({ action: "opened", issue: { number: 1 } });
const SIGNATURE = `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(BODY).digest("hex")}`;

function verifyJwt(jwt: string, appId: string) {
  const [h, p, s] = jwt.split(".");
  const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s!, "base64url"));
  const payload = JSON.parse(Buffer.from(p!, "base64url").toString()) as { iat: number; exp: number; iss: string };
  return { ok, payload, appId };
}

function checkJwt(jwt: string) {
  const { ok, payload } = verifyJwt(jwt, "123");
  expect(ok).toBe(true);
  expect(payload.iss).toBe("123");
  const now = Math.floor(Date.now() / 1000);
  expect(payload.iat).toBeLessThanOrEqual(now - 59);
  expect(payload.exp - payload.iat).toBeLessThanOrEqual(600);
}

describe("crypto on Node", () => {
  it.each([
    ["PKCS#1", PKCS1],
    ["PKCS#8", PKCS8],
  ])("signs an App JWT with a %s key", async (_name, pem) => {
    checkJwt(await createAppJwt("123", await importAppPrivateKey(pem)));
  });

  it("verifies webhook signatures and rejects tampering", async () => {
    expect(await verifyWebhookSignature(WEBHOOK_SECRET, BODY, SIGNATURE)).toBe(true);
    expect(await verifyWebhookSignature(WEBHOOK_SECRET, `${BODY} `, SIGNATURE)).toBe(false);
    expect(await verifyWebhookSignature("other-secret", BODY, SIGNATURE)).toBe(false);
    expect(await verifyWebhookSignature(WEBHOOK_SECRET, BODY, null)).toBe(false);
    expect(await verifyWebhookSignature(WEBHOOK_SECRET, BODY, "sha256=zz")).toBe(false);
  });

  it("seals secrets bound to their purpose and fails on a changed key", async () => {
    const box = await createSecretBox("secret-one");
    const sealed = await box.seal("private-key", "github_app.private_key");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("private-key");
    expect(await box.open(sealed, "github_app.private_key")).toBe("private-key");
    await expect(box.open(sealed, "github_app.client_secret")).rejects.toBeInstanceOf(SecretBoxError);
    await expect((await createSecretBox("secret-two")).open(sealed, "github_app.private_key")).rejects.toBeInstanceOf(SecretBoxError);
  });
});

describe("crypto inside workerd", () => {
  let worker: Awaited<ReturnType<typeof unstable_startWorker>>;

  beforeAll(async () => {
    worker = await unstable_startWorker({
      name: "gitwork-crypto-test",
      entrypoint: fileURLToPath(new URL("./workerd/crypto-worker.ts", import.meta.url)),
      compatibilityDate: "2026-10-01",
      compatibilityFlags: ["nodejs_compat"],
      dev: { server: { port: 0 }, inspector: false, logLevel: "error" },
    });
    await worker.ready;
  }, 60_000);

  afterAll(async () => {
    await worker?.dispose();
  });

  it("signs, verifies, and seals the same way as Node", async () => {
    const box = await createSecretBox("shared-secret");
    const res = await worker.fetch("http://worker/", {
      method: "POST",
      body: JSON.stringify({
        pem: PKCS1,
        appId: "123",
        webhookSecret: WEBHOOK_SECRET,
        body: BODY,
        signature: SIGNATURE,
        boxSecret: "shared-secret",
        sealedByNode: await box.seal("from-node", "column-a"),
      }),
    });
    const out = (await res.json()) as Record<string, unknown>;
    expect(out.runtime).toBe("Cloudflare-Workers");
    checkJwt(out.jwt as string);
    expect(out.signatureValid).toBe(true);
    expect(out.signatureTampered).toBe(false);
    expect(out.roundTrip).toBe("from-workerd");
    expect(out.openedNodeSeal).toBe("from-node");
    expect(out.wrongPurpose).toBe("SecretBoxError");
    // And Node opens what workerd sealed.
    expect(await box.open(out.sealed as string, "column-a")).toBe("from-workerd");
  });
});
