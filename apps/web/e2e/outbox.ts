import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { E2E_OUTBOX } from "../playwright.config";

interface Message {
  to: string;
  subject: string;
  text: string;
}

/** The newest email to `to` whose text matches `pattern`. Polls: sending is async. */
export async function lastEmail(to: string, pattern: RegExp): Promise<RegExpExecArray> {
  let found: RegExpExecArray | null = null;
  await expect
    .poll(() => {
      let lines: string[] = [];
      try {
        lines = readFileSync(E2E_OUTBOX, "utf8").trim().split("\n");
      } catch {
        return false;
      }
      const messages = lines.filter(Boolean).map((l) => JSON.parse(l) as Message);
      const match = messages
        .filter((m) => m.to === to)
        .map((m) => pattern.exec(m.text))
        .filter((m): m is RegExpExecArray => m !== null)
        .at(-1);
      found = match ?? null;
      return found !== null;
    })
    .toBe(true);
  return found!;
}

export const signInCode = async (email: string) => (await lastEmail(email, /sign-in code is (\d{6})/))[1]!;
