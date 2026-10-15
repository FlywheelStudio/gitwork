import type { Database } from "@gitwork/db";
import { createAuth } from "../src/auth";
import { memorySender } from "../src/email";

export const BASE_URL = "http://localhost:3000";

export function testAuth(database: Database) {
  const email = memorySender();
  const auth = createAuth({ database, secret: "test-secret-test-secret-test-secret-32", baseURL: BASE_URL, email });
  return { auth, email };
}

/** Calls the auth HTTP handler the way a browser on BASE_URL would. */
export function authRequest(
  auth: ReturnType<typeof createAuth>,
  path: string,
  init: { body?: unknown; cookie?: string; ip?: string; method?: string } = {},
): Promise<Response> {
  const headers = new Headers({ origin: BASE_URL, "x-forwarded-for": init.ip ?? "203.0.113.7" });
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.cookie) headers.set("cookie", init.cookie);
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

/** The code from the last sign-in email. */
export function lastCode(messages: { text: string }[]): string {
  const match = /sign-in code is (\d{6})/.exec(messages.at(-1)?.text ?? "");
  if (!match) throw new Error("no sign-in code in the last email");
  return match[1]!;
}

/** Signs a user in by email code and returns the session cookie. */
export async function signIn(
  auth: ReturnType<typeof createAuth>,
  sender: { messages: { text: string }[] },
  address: string,
): Promise<string> {
  const sent = await authRequest(auth, "/email-otp/send-verification-otp", { body: { email: address, type: "sign-in" } });
  if (!sent.ok) throw new Error(`send code failed: ${sent.status} ${await sent.text()}`);
  const res = await authRequest(auth, "/sign-in/email-otp", { body: { email: address, otp: lastCode(sender.messages) } });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  return cookieFrom(res);
}

export function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
