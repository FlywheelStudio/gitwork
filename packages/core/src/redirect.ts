/**
 * A same-origin path for a `?next=` redirect, or "/" for anything else. Resolves the value as a
 * browser would, so `//evil.com`, `/\evil.com`, and encoded forms cannot leave the site.
 */
export function safeRedirectPath(value: string | null | undefined, origin: string): string {
  if (!value || !value.startsWith("/")) return "/";
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return "/";
  }
  if (url.origin !== new URL(origin).origin) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
