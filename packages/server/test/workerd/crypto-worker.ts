// Runs the crypto module inside workerd. test/crypto.workerd.test.ts starts it with wrangler.
import { createAppJwt, createSecretBox, importAppPrivateKey, verifyWebhookSignature } from "../../src/github/crypto";

export default {
  async fetch(request: Request): Promise<Response> {
    const input = (await request.json()) as {
      pem: string;
      appId: string;
      webhookSecret: string;
      body: string;
      signature: string;
      boxSecret: string;
      sealedByNode: string;
    };
    const box = await createSecretBox(input.boxSecret);
    const sealed = await box.seal("from-workerd", "column-a");
    let wrongPurpose = "opened";
    try {
      await box.open(sealed, "column-b");
    } catch (e) {
      wrongPurpose = (e as Error).name;
    }
    return Response.json({
      runtime: navigator.userAgent,
      jwt: await createAppJwt(input.appId, await importAppPrivateKey(input.pem)),
      signatureValid: await verifyWebhookSignature(input.webhookSecret, input.body, input.signature),
      signatureTampered: await verifyWebhookSignature(input.webhookSecret, `${input.body} `, input.signature),
      sealed,
      roundTrip: await box.open(sealed, "column-a"),
      openedNodeSeal: await box.open(input.sealedByNode, "column-a"),
      wrongPurpose,
    });
  },
};
