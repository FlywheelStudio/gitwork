/** Loader and string-level runner for the shared round-trip fixtures (fixtures/docs/README.md). */
import { addFrontmatterKey, removeFrontmatterKey, setFrontmatterValue } from "./frontmatter";
import { type TextChange, applyChange, lineSeparatorOf } from "./text";

export type FixtureOp =
  | { find: string; replace: string }
  | { frontmatter: "set" | "add" | "remove"; key: string; value?: string; expectNull?: boolean };

export interface FixtureCase {
  name: string;
  input?: string;
  inputBase64?: string;
  editable?: boolean;
  separator?: "\n" | "\r\n";
  ops?: FixtureOp[];
  expected?: string;
}

/** The change one op makes to `text`, or null when the op must be refused. */
export function opChange(text: string, op: FixtureOp): TextChange | null {
  if ("find" in op) {
    const from = text.indexOf(op.find);
    if (from === -1) throw new Error(`fixture: "${op.find}" not found`);
    return { from, to: from + op.find.length, insert: op.replace };
  }
  if (op.frontmatter === "set") return setFrontmatterValue(text, op.key, op.value ?? "");
  if (op.frontmatter === "add") return addFrontmatterKey(text, op.key, op.value ?? "", lineSeparatorOf(text));
  return removeFrontmatterKey(text, op.key);
}

export function runOps(text: string, ops: FixtureOp[]): string {
  let out = text;
  for (const op of ops) {
    const change = opChange(out, op);
    const refused = "frontmatter" in op && op.expectNull === true;
    if (refused !== (change === null)) throw new Error(`fixture op ${JSON.stringify(op)}: ${refused ? "should be refused" : "was refused"}`);
    if (change) out = applyChange(out, change);
  }
  return out;
}
