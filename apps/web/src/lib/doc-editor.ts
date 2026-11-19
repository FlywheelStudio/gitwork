/**
 * CodeMirror state for byte-exact docs (decision 011). Framework-free, so the shared round-trip
 * fixtures run against it in Vitest without a browser.
 *
 * CodeMirror splits lines on \r\n, \r, and \n and joins them with \n unless told otherwise, which
 * would rewrite every CRLF file on the first save. So the separator is always set explicitly:
 * "\r\n" when every break is CRLF, else "\n" (a stray \r stays part of its line's text). Typed and
 * pasted text gets the file's separator, so a new line never mixes styles into an old file.
 */
import { type Extension, EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { type LineSeparator, type TextChange, lineSeparatorOf, offsetToEditorPos } from "@gitwork/core";

/** Rewrites line breaks in inserted text to the file's separator. */
export function separatorFilter(separator: LineSeparator): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !(tr.isUserEvent("input") || tr.isUserEvent("paste") || tr.isUserEvent("drop"))) return tr;
    let needs = false;
    tr.changes.iterChanges((_a, _b, _c, _d, inserted) => {
      for (let i = 1; i <= inserted.lines && !needs; i++) {
        const line = inserted.line(i).text;
        if (separator === "\r\n" ? /[\r\n]/.test(line) : /\r$/.test(line) && i < inserted.lines) needs = true;
      }
    });
    if (!needs) return tr;
    const changes: { from: number; to: number; insert: string }[] = [];
    tr.changes.iterChanges((fromA, toA, _fb, _tb, inserted) => {
      const raw = inserted.sliceString(0, inserted.length, "\n");
      changes.push({ from: fromA, to: toA, insert: raw.replace(/\r\n|\r|\n/g, separator) });
    });
    // The state splits inserted text on its own separator only, so insert exactly that.
    return [{ changes, selection: tr.selection, scrollIntoView: tr.scrollIntoView, userEvent: tr.annotation(Transaction.userEvent) } as TransactionSpec];
  });
}

export function docExtensions(text: string): Extension[] {
  const separator = lineSeparatorOf(text);
  return [EditorState.lineSeparator.of(separator), separatorFilter(separator)];
}

/**
 * The file text. Never `state.doc.toString()`: that always joins lines with "\n".
 * `sliceDoc` joins them with the state's separator.
 */
export function docText(state: EditorState): string {
  return state.sliceDoc();
}

/** A state whose `docText` is exactly `text`. */
export function createDocState(text: string, extensions: Extension[] = []): EditorState {
  return EditorState.create({ doc: text, extensions: [...docExtensions(text), ...extensions] });
}

/** A change in string offsets (core helpers) as a transaction on the editor's positions. */
export function changeSpec(state: EditorState, change: TextChange): TransactionSpec {
  const text = docText(state);
  const separator = state.lineBreak === "\r\n" ? "\r\n" : "\n";
  return {
    changes: {
      from: offsetToEditorPos(text, change.from, separator),
      to: offsetToEditorPos(text, change.to, separator),
      insert: change.insert,
    },
  };
}
