/**
 * Byte-exact doc text (decision 011). A file's bytes become a string and back with no change:
 * the BOM stays, line endings stay, and invalid UTF-8 is refused instead of repaired.
 */

/** Docs larger than this open read-only. D1 caps a value at 2 MB; the cache stores the text. */
export const MAX_EDITABLE_BYTES = 1_000_000;

/** GitHub wraps base64 at 60 columns; whitespace is not part of the data. */
export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** The text of a UTF-8 file, or null when the bytes are not valid UTF-8 (open it read-only). */
export function bytesToText(bytes: Uint8Array): string | null {
  try {
    // ignoreBOM: keep a leading U+FEFF in the string, so it is written back.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export type LineSeparator = "\r\n" | "\n";

/**
 * The separator an editor must split and join lines on. "\r\n" only when every line break is
 * CRLF. Otherwise "\n": a CR before a LF (mixed files) or alone stays part of the line's text.
 */
export function lineSeparatorOf(text: string): LineSeparator {
  const lf = text.split("\n").length - 1;
  if (lf === 0) return "\n";
  const crlf = text.split("\r\n").length - 1;
  const cr = text.split("\r").length - 1;
  return crlf === lf && cr === crlf ? "\r\n" : "\n";
}

/**
 * A string offset as an editor position. Editors count a line break as one position; with a CRLF
 * separator the string has two characters for it.
 */
export function offsetToEditorPos(text: string, offset: number, separator: LineSeparator): number {
  if (separator === "\n") return offset;
  return offset - (text.slice(0, offset).split("\r\n").length - 1);
}

/** One text change in string offsets. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export function applyChange(text: string, change: TextChange): string {
  return text.slice(0, change.from) + change.insert + text.slice(change.to);
}
