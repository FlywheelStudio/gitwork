/**
 * Doc paths (decision 011). A path is repo-relative, "/"-separated, with no leading or trailing
 * slash. Every path from a client or a markdown link passes through these before any use.
 */

export const MAX_PATH_LENGTH = 400;
/** The whole repo (decision 038). A root is "" or a folder path. */
export const REPO_ROOT = "";
/** What a newly linked repo shows (decision 039). */
export const DEFAULT_DOCS_ROOT = "docs";

// Control characters and backslashes never appear in a path we accept.
const BAD_CHARS = /[\u0000-\u001f\u007f\\]/;

function cleanSegments(input: string): string[] | null {
  if (input.length === 0 || input.length > MAX_PATH_LENGTH || BAD_CHARS.test(input)) return null;
  const segments = input.split("/");
  for (const s of segments) {
    if (s === "" || s === "." || s === ".." || s.trim() !== s || s.toLowerCase() === ".git") return null;
  }
  return segments;
}

/** A repo-relative file path, or null when it is unsafe or malformed. */
export function normalizeDocPath(input: string): string | null {
  const segments = cleanSegments(input);
  return segments ? segments.join("/") : null;
}

/** A docs folder setting. Leading and trailing slashes are dropped; "" (or "/") is the whole repo. */
export function normalizeRoot(input: string): string | null {
  const trimmed = input.trim().replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? REPO_ROOT : normalizeDocPath(trimmed);
}

export function isUnderRoot(path: string, root: string): boolean {
  return root === REPO_ROOT ? path.length > 0 : path.startsWith(`${root}/`);
}

/** The part of `path` below `root` ("docs/a/b.md" → "a/b.md"). */
export function relativeToRoot(path: string, root: string): string {
  return root !== REPO_ROOT && isUnderRoot(path, root) ? path.slice(root.length + 1) : path;
}

/** `rel` inside `root`. */
export function joinRoot(root: string, rel: string): string {
  return root === REPO_ROOT ? rel : `${root}/${rel}`;
}

/** The folder a file sits in ("" at the repo root). */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? REPO_ROOT : path.slice(0, slash);
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
};

/** The image media type for a path, or null when it is not an image we serve inline. */
export function imageType(path: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return ext ? (IMAGE_TYPES[ext] ?? null) : null;
}

/**
 * A link target in a doc, resolved against the doc's folder. Null for anything that is not a
 * repo-relative file: URLs with a scheme, absolute paths, fragments, and paths that leave the repo.
 */
export function resolveRelative(fromDocPath: string, href: string): string | null {
  const target = href.trim().split(/[?#]/)[0] ?? "";
  if (!target || target.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return null;
  }
  const parts = fromDocPath.split("/").slice(0, -1);
  for (const seg of decoded.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return normalizeDocPath(parts.join("/"));
}

/** A file name for an uploaded image: lowercase, safe characters, the extension kept. */
export function safeFileName(input: string): string {
  const name = (input.split(/[\\/]/).pop() ?? "").replace(/^\.+/, "");
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  return `${base || "image"}${ext ? `.${ext}` : ""}`;
}

/** A relative link from one doc to another file ("docs/guide/a.md" → "docs/assets/x.png" = "../assets/x.png"). */
export function relativeLink(fromDocPath: string, toPath: string): string {
  const from = fromDocPath.split("/").slice(0, -1);
  const to = toPath.split("/");
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  const up = from.length - common;
  const rel = [...Array<string>(up).fill(".."), ...to.slice(common)].join("/");
  // Spaces and parentheses would end a markdown link early.
  return rel
    .split("/")
    .map((s) => (s === ".." ? s : encodeURIComponent(s).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)))
    .join("/");
}
