import { APP_NAME } from "@gitwork/core";
import type { EmailMessage } from "./email";

/**
 * One email, one secret, two ways in: type the code, or open the link.
 * The code rides in the URL fragment, which browsers never send to the server, and the page
 * verifies only on a click (POST). Email link scanners fetch links; a GET must never use the code.
 */
export function signInEmail(input: { baseURL: string; email: string; code: string }): EmailMessage {
  const fragment = new URLSearchParams({ email: input.email, code: input.code }).toString();
  const link = `${input.baseURL.replace(/\/$/, "")}/sign-in/verify#${fragment}`;
  const text = [
    `Your ${APP_NAME} sign-in code is ${input.code}`,
    "",
    `Or open this link to sign in: ${link}`,
    "",
    "The code expires in 10 minutes. If you did not ask for it, ignore this email.",
  ].join("\n");
  const html = `<p>Your ${APP_NAME} sign-in code is</p>
<p style="font-size:28px;font-weight:600;letter-spacing:4px">${input.code}</p>
<p><a href="${escapeHtml(link)}">Sign in to ${APP_NAME}</a></p>
<p style="color:#666">The code expires in 10 minutes. If you did not ask for it, ignore this email.</p>`;
  return { to: input.email, subject: `${input.code} is your ${APP_NAME} sign-in code`, text, html };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
