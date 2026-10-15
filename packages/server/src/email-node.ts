/** Node-only email adapters. Never import from Worker code (decision 016's driver split applies). */
import { appendFile } from "node:fs/promises";
import { createTransport } from "nodemailer";
import type { EmailSender } from "./email";

/** SMTP through nodemailer. `url` is an SMTP URL, e.g. smtps://user:pass@smtp.example.com. */
export function smtpSender(url: string, from: string): EmailSender {
  const transport = createTransport(url);
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}

/** Appends each message as a JSON line. E2E tests read it to get sign-in codes. Tests only. */
export function outboxSender(path: string): EmailSender {
  return {
    async send(message) {
      await appendFile(path, `${JSON.stringify(message)}\n`);
    },
  };
}
