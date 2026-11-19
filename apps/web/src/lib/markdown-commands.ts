/**
 * Toolbar and shortcut commands. Each one is a small text edit on the source, so the file stays
 * plain markdown and only the touched lines change.
 */
import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Wraps each selection in `mark` (e.g. "**"), or unwraps it when it is already wrapped. */
export function toggleWrap(state: EditorState, mark: string): TransactionSpec {
  return state.changeByRange((range) => {
    const before = state.sliceDoc(range.from - mark.length, range.from);
    const after = state.sliceDoc(range.to, range.to + mark.length);
    if (before === mark && after === mark) {
      return {
        changes: [
          { from: range.from - mark.length, to: range.from },
          { from: range.to, to: range.to + mark.length },
        ],
        range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
      };
    }
    return {
      changes: [
        { from: range.from, insert: mark },
        { from: range.to, insert: mark },
      ],
      range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
    };
  });
}

const LINE_PREFIX = /^(\s*)(#{1,6} |> |- \[[ xX]\] |[-*+] |\d+[.)] )?/;

/** Sets each selected line's block prefix ("# ", "- ", "> " …). The same prefix again removes it. */
export function setLinePrefix(state: EditorState, prefix: string): TransactionSpec {
  const changes: { from: number; to: number; insert: string }[] = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let pos = range.from; pos <= range.to; ) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const m = LINE_PREFIX.exec(line.text)!;
        const indent = m[1]!.length;
        const current = m[2] ?? "";
        changes.push({ from: line.from + indent, to: line.from + indent + current.length, insert: current === prefix ? "" : prefix });
      }
      pos = line.to + 1;
    }
  }
  return { changes };
}

/** "[text](url)" around the selection, with the cursor in the url. */
export function insertLink(state: EditorState): TransactionSpec {
  return state.changeByRange((range) => {
    const label = state.sliceDoc(range.from, range.to) || "link";
    const insert = `[${label}](url)`;
    const urlFrom = range.from + label.length + 3;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(urlFrom, urlFrom + 3) };
  });
}

export function run(view: EditorView, spec: (state: EditorState) => TransactionSpec) {
  if (view.state.readOnly) return false;
  view.dispatch(view.state.update(spec(view.state), { userEvent: "input.format", scrollIntoView: true }));
  view.focus();
  return true;
}
