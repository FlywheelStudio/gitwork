import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { E2E_OUTBOX } from "../playwright.config";

interface Message {
  to: string;
  subject: string;
  text: string;
}

function readMessages(): Message[] {
  try {
    return readFileSync(E2E_OUTBOX, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Message);
  } catch {
    return [];
  }
}

/** How many emails `to` has received so far. Pass it to `signInCode` to wait for a newer one. */
export const emailCount = (to: string) => readMessages().filter((m) => m.to === to).length;

/**
 * The newest email to `to` whose text matches `pattern`. Polls: sending is async. With `after`,
 * waits until `to` has more than `after` emails, so a second sign-in never reads the first code.
 */
export async function lastEmail(to: string, pattern: RegExp, after = 0): Promise<RegExpExecArray> {
  let found: RegExpExecArray | null = null;
  await expect
    .poll(() => {
      const mine = readMessages().filter((m) => m.to === to);
      if (mine.length <= after) return false;
      const match = mine
        .map((m) => pattern.exec(m.text))
        .filter((m): m is RegExpExecArray => m !== null)
        .at(-1);
      found = match ?? null;
      return found !== null;
    })
    .toBe(true);
  return found!;
}

export const signInCode = async (email: string, after = 0) => (await lastEmail(email, /sign-in code is (\d{6})/, after))[1]!;
