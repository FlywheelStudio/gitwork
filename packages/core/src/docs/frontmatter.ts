/**
 * The frontmatter panel (decision 011). It never parses and re-dumps YAML: each edit replaces the
 * value text on one line, so every other byte of the file stays as it was. Values the panel cannot
 * edit safely (lists, maps, block scalars, comments) show as read-only.
 */
import type { TextChange } from "./text";

export interface FrontmatterEntry {
  key: string;
  /** The value as shown: quotes removed for simple strings, the raw text otherwise. */
  value: string;
  /** False for lists, maps, multi-line, and commented values: edit those in the source. */
  editable: boolean;
  /** String offsets of the raw value on its line (empty range when the line is "key:"). */
  valueFrom: number;
  valueTo: number;
  /** The whole line, including its line break. */
  lineFrom: number;
  lineTo: number;
  quote: '"' | "'" | null;
}

export interface Frontmatter {
  entries: FrontmatterEntry[];
  /** Offset of the closing "---" line's start: new keys go here. */
  insertAt: number;
  /** The line break the block uses. */
  lineBreak: string;
}

const KEY = /^([A-Za-z_][\w-]*(?: [\w-]+)*):(?:[ \t]+(.*?))?[ \t]*$/;

function lines(text: string, from: number, to: number): { start: number; end: number; content: string; br: string }[] {
  const out = [];
  let pos = from;
  while (pos < to) {
    const nl = text.indexOf("\n", pos);
    const end = nl === -1 || nl >= to ? to : nl + 1;
    let content = text.slice(pos, end);
    let br = "";
    if (content.endsWith("\r\n")) [content, br] = [content.slice(0, -2), "\r\n"];
    else if (content.endsWith("\n")) [content, br] = [content.slice(0, -1), "\n"];
    out.push({ start: pos, end, content, br });
    pos = end;
  }
  return out;
}

function unquote(raw: string): { value: string; quote: '"' | "'" | null; simple: boolean } {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    const inner = raw.slice(1, -1);
    // Escapes other than \" and \\ (\n, \t, \u…) are left to the source editor.
    if (/\\[^"\\]/.test(inner) || /(^|[^\\])"/.test(inner.replace(/\\\\/g, ""))) return { value: raw, quote: null, simple: false };
    return { value: inner.replace(/\\(["\\])/g, "$1"), quote: '"', simple: true };
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    const inner = raw.slice(1, -1);
    if (/(^|[^'])'(?!')/.test(inner)) return { value: raw, quote: null, simple: false };
    return { value: inner.replace(/''/g, "'"), quote: "'", simple: true };
  }
  const simple = raw !== "" && !/^[[{|>&*!%@`]/.test(raw) && !/\s#/.test(raw);
  return { value: raw, quote: null, simple };
}

/** The frontmatter block at the top of a doc (after an optional BOM), or null when there is none. */
export function parseFrontmatter(text: string): Frontmatter | null {
  const start = text.startsWith("\uFEFF") ? 1 : 0;
  const all = lines(text, start, text.length);
  if (all.length < 2 || all[0]!.content !== "---") return null;
  const close = all.findIndex((l, i) => i > 0 && (l.content === "---" || l.content === "..."));
  if (close === -1) return null;
  const entries: FrontmatterEntry[] = [];
  for (let i = 1; i < close; i++) {
    const line = all[i]!;
    const m = KEY.exec(line.content);
    if (!m) {
      // An indented or list line belongs to the key above it: that value is not simple.
      const prev = entries[entries.length - 1];
      if (prev && /^[ \t-]/.test(line.content)) {
        prev.editable = false;
        prev.lineTo = line.end;
      }
      continue;
    }
    const raw = m[2] ?? "";
    // The key cannot contain ":", so the first one ends it.
    const afterColon = line.start + line.content.indexOf(":") + 1;
    const valueFrom = raw ? afterColon + text.slice(afterColon, line.start + line.content.length).search(/\S/) : afterColon;
    const parsed = unquote(raw);
    entries.push({
      key: m[1]!,
      value: parsed.value,
      editable: raw === "" ? true : parsed.simple,
      valueFrom,
      valueTo: valueFrom + raw.length,
      lineFrom: line.start,
      lineTo: line.end,
      quote: parsed.quote,
    });
  }
  return { entries, insertAt: all[close]!.start, lineBreak: all[0]!.br || "\n" };
}

const RESERVED = /^(?:true|false|yes|no|on|off|null|~|[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?|0x[0-9a-f]+|\.inf|\.nan)$/i;

/** YAML text for a string value. Keeps the old quote style; quotes when plain text would change. */
export function formatValue(value: string, quote: '"' | "'" | null = null): string {
  if (quote === "'") return `'${value.replace(/'/g, "''")}'`;
  const plainOk =
    value !== "" &&
    value.trim() === value &&
    !/[\r\n]/.test(value) &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) &&
    !/: |\s#|:$/.test(value) &&
    !RESERVED.test(value);
  if (quote === null && plainOk) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}

/** The change that sets one editable key, or null when the key is missing or not editable. */
export function setFrontmatterValue(text: string, key: string, value: string): TextChange | null {
  const fm = parseFrontmatter(text);
  const entry = fm?.entries.find((e) => e.key === key);
  if (!entry || !entry.editable) return null;
  const formatted = formatValue(value, entry.quote);
  if (entry.valueFrom === entry.valueTo) return { from: entry.valueFrom, to: entry.valueTo, insert: ` ${formatted}` };
  return { from: entry.valueFrom, to: entry.valueTo, insert: formatted };
}

const NEW_KEY = /^[A-Za-z_][\w-]*$/;

/** The change that adds a key at the end of the block, or creates the block at the top. */
export function addFrontmatterKey(text: string, key: string, value: string, lineBreak = "\n"): TextChange | null {
  if (!NEW_KEY.test(key)) return null;
  const fm = parseFrontmatter(text);
  if (fm?.entries.some((e) => e.key === key)) return null;
  if (fm) return { from: fm.insertAt, to: fm.insertAt, insert: `${key}: ${formatValue(value)}${fm.lineBreak}` };
  const at = text.startsWith("\uFEFF") ? 1 : 0;
  return { from: at, to: at, insert: `---${lineBreak}${key}: ${formatValue(value)}${lineBreak}---${lineBreak}` };
}

/** The change that removes one key and its value lines. */
export function removeFrontmatterKey(text: string, key: string): TextChange | null {
  const entry = parseFrontmatter(text)?.entries.find((e) => e.key === key);
  return entry ? { from: entry.lineFrom, to: entry.lineTo, insert: "" } : null;
}
