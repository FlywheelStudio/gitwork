/** Email adapters (decision 004). Runtime-neutral: no Node or Workers imports here. */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Development only. Prints the message, including sign-in codes, to the server log. */
export function consoleSender(): EmailSender {
  return {
    async send(message) {
      console.info(`[email] to=${message.to} subject=${message.subject}\n${message.text}`);
    },
  };
}

/** Production with nothing configured: refuse to send rather than leak codes to a log. */
export function unconfiguredSender(): EmailSender {
  return {
    async send() {
      throw new Error("Email is not configured. Set EMAIL_TRANSPORT (smtp or cloudflare).");
    },
  };
}

/** Cloudflare Workers: the `send_email` binding (Cloudflare Email Service). */
export function cloudflareSender(binding: SendEmail, from: { email: string; name: string }): EmailSender {
  return {
    async send(message) {
      await binding.send({ from, to: message.to, subject: message.subject, text: message.text, html: message.html });
    },
  };
}

/** Parses `Name <address>` or a bare address. */
export function parseFrom(value: string): { email: string; name: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  return match ? { name: match[1] ?? "", email: match[2]! } : { name: "", email: value.trim() };
}

/** Records messages in memory. Tests only. */
export function memorySender(): EmailSender & { messages: EmailMessage[] } {
  const messages: EmailMessage[] = [];
  return {
    messages,
    async send(message) {
      messages.push(message);
    },
  };
}
