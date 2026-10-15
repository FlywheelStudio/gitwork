/**
 * Web Crypto only: runs the same on Node and Workers. Tested in both (test/workerd/).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Secret box: AES-GCM with a key derived (HKDF-SHA256) from BETTER_AUTH_SECRET.
// Format: "v1." + base64url(iv ‖ ciphertext). The purpose (e.g. the column name) is bound as
// additional data, so a ciphertext cannot be moved to another column.
// ---------------------------------------------------------------------------------------------

export class SecretBoxError extends Error {
  constructor() {
    super("Stored secret cannot be decrypted. Was BETTER_AUTH_SECRET changed? Re-run setup at /setup.");
    this.name = "SecretBoxError";
  }
}

export interface SecretBox {
  seal(plaintext: string, purpose: string): Promise<string>;
  open(sealed: string, purpose: string): Promise<string>;
}

export async function createSecretBox(secret: string): Promise<SecretBox> {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("gitwork"), info: enc.encode("secret-box:v1") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return {
    async seal(plaintext, purpose) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(purpose) }, key, enc.encode(plaintext)),
      );
      const out = new Uint8Array(iv.length + ct.length);
      out.set(iv);
      out.set(ct, iv.length);
      return `v1.${toB64Url(out)}`;
    },
    async open(sealed, purpose) {
      if (!sealed.startsWith("v1.")) throw new SecretBoxError();
      const raw = fromB64Url(sealed.slice(3));
      try {
        const pt = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: raw.slice(0, 12), additionalData: enc.encode(purpose) },
          key,
          raw.slice(12),
        );
        return dec.decode(pt);
      } catch {
        throw new SecretBoxError();
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Webhook signatures: X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(secret, raw body)).
// crypto.subtle.verify compares in constant time.
// ---------------------------------------------------------------------------------------------

export async function verifyWebhookSignature(secret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const hex = header.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
  const sig = new Uint8Array(32);
  for (let i = 0; i < 32; i++) sig[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, sig, enc.encode(rawBody));
}

// ---------------------------------------------------------------------------------------------
// GitHub App JWT (RS256). The manifest flow returns a PKCS#1 key ("BEGIN RSA PRIVATE KEY");
// Web Crypto imports only PKCS#8, so wrap PKCS#1 in a PKCS#8 envelope first.
// ---------------------------------------------------------------------------------------------

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function der(tag: number, content: Uint8Array): Uint8Array<ArrayBuffer> {
  const len = derLength(content.length);
  const out = new Uint8Array(1 + len.length + content.length);
  out[0] = tag;
  out.set(len, 1);
  out.set(content, 1 + len.length);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// AlgorithmIdentifier { rsaEncryption (1.2.840.113549.1.1.1), NULL }
const RSA_ALGORITHM_ID = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);

function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  return der(0x30, concat(version, RSA_ALGORITHM_ID, der(0x04, pkcs1)));
}

function pemBody(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function importAppPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pemBody(pem);
  const pkcs8 = pem.includes("BEGIN RSA PRIVATE KEY") ? pkcs1ToPkcs8(body) : body;
  return crypto.subtle.importKey("pkcs8", pkcs8, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** A GitHub App JWT: issued 60 s in the past (clock skew), valid for 9 minutes (max 10). */
export async function createAppJwt(appId: string, privateKey: CryptoKey, nowMs = Date.now()): Promise<string> {
  const now = Math.floor(nowMs / 1000);
  const header = toB64Url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = toB64Url(enc.encode(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId })));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${toB64Url(new Uint8Array(sig))}`;
}
