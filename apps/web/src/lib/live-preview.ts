/**
 * Live preview (decision 011, decision 037): the editor shows formatted text and hides markdown
 * marks on every line the cursor is not on. Only decorations change; the text itself never does,
 * so the round-trip guarantee holds. On the cursor's lines the source shows for editing.
 */
import { HighlightStyle, syntaxTree } from "@codemirror/language";
import { offsetToEditorPos, parseFrontmatter } from "@gitwork/core";
import { tags } from "@lezer/highlight";
import { type EditorState, type Extension, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

export interface LivePreviewOptions {
  /** A URL for an image link in the doc, or null to leave the source showing. */
  resolveImage: (src: string) => string | null;
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-lp-bullet";
    span.textContent = "•";
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
  ) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lp-task";
    box.checked = this.checked;
    box.setAttribute("aria-label", this.checked ? "Done" : "Not done");
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (view.state.readOnly) return;
      // "[ ]" ↔ "[x]": one character, the rest of the line stays as it was.
      view.dispatch({ changes: { from: this.from + 1, to: this.from + 2, insert: this.checked ? " " : "x" }, userEvent: "input.toggle" });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement("hr");
    hr.className = "cm-lp-hr";
    return hr;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.url === this.url && other.alt === this.alt;
  }
  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-lp-image";
    img.src = this.url;
    img.alt = this.alt;
    img.loading = "lazy";
    return img;
  }
}

const hide = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });
const line = (cls: string) => Decoration.line({ class: cls });

/** Line numbers any selection range touches. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

function build(state: EditorState, options: LivePreviewOptions, focused: boolean): DecorationSet {
  const out: Range<Decoration>[] = [];
  // Without focus there is no line being edited: everything renders.
  const active = focused ? activeLines(state) : new Set<number>();
  const isActive = (from: number, to: number) => {
    const a = state.doc.lineAt(from).number;
    const b = state.doc.lineAt(to).number;
    for (let n = a; n <= b; n++) if (active.has(n)) return true;
    return false;
  };
  const text = (from: number, to: number) => state.sliceDoc(from, to);

  // Frontmatter: the properties panel shows it, so rich text hides the block. The parser would
  // read it as a rule and a setext heading. On the cursor's lines it shows as plain source.
  let fmEnd = -1;
  const head = state.sliceDoc(0, Math.min(state.doc.length, 64_000));
  const fm = parseFrontmatter(head);
  if (fm) {
    const separator = state.lineBreak === "\r\n" ? "\r\n" : "\n";
    const start = head.startsWith("\uFEFF") ? 1 : 0;
    const closing = state.doc.lineAt(offsetToEditorPos(head, fm.insertAt, separator));
    fmEnd = closing.to;
    if (isActive(start, fmEnd)) {
      for (let pos = start; pos <= fmEnd; ) {
        const l = state.doc.lineAt(pos);
        out.push(line("cm-lp-frontmatter").range(l.from));
        pos = l.to + 1;
      }
    } else {
      out.push(Decoration.replace({ block: true }).range(state.doc.lineAt(start).from, fmEnd));
    }
  }

  syntaxTree(state).iterate({
    from: fmEnd + 1,
    enter(node) {
      const { from, to, name } = node;
      if (from <= fmEnd) return;
      const heading = /^ATXHeading(\d)$/.exec(name);
      if (heading) {
        out.push(line(`cm-lp-h cm-lp-h${heading[1]}`).range(state.doc.lineAt(from).from));
        return;
      }
      switch (name) {
        case "HeaderMark": {
          if (isActive(from, to) || node.node.parent?.name.startsWith("SetextHeading")) return;
          // The marks and the space after them.
          const end = text(to, to + 1) === " " ? to + 1 : to;
          out.push(hide.range(from, end));
          return;
        }
        case "Emphasis":
          out.push(mark("cm-lp-em").range(from, to));
          return;
        case "StrongEmphasis":
          out.push(mark("cm-lp-strong").range(from, to));
          return;
        case "Strikethrough":
          out.push(mark("cm-lp-strike").range(from, to));
          return;
        case "InlineCode":
          out.push(mark("cm-lp-code").range(from, to));
          return;
        case "Link":
          out.push(mark("cm-lp-link").range(from, to));
          return;
        case "EmphasisMark":
        case "StrikethroughMark":
          if (!isActive(from, to)) out.push(hide.range(from, to));
          return;
        case "CodeMark":
          // Inline code only; a fenced block keeps its fences.
          if (node.node.parent?.name === "InlineCode" && !isActive(from, to)) out.push(hide.range(from, to));
          return;
        case "LinkMark":
        case "URL":
        case "LinkTitle":
          if (node.node.parent?.name === "Link" && !isActive(from, to)) out.push(hide.range(from, to));
          return;
        case "Image": {
          if (isActive(from, to)) return false;
          const source = text(from, to);
          const m = /^!\[([^\]]*)\]\(\s*<?([^\s>)]+)>?/.exec(source);
          const url = m ? options.resolveImage(m[2]!) : null;
          if (url) out.push(Decoration.replace({ widget: new ImageWidget(url, m![1]!) }).range(from, to));
          return false;
        }
        case "Blockquote": {
          for (let pos = from; pos <= to; ) {
            const l = state.doc.lineAt(pos);
            out.push(line("cm-lp-quote").range(l.from));
            pos = l.to + 1;
          }
          return;
        }
        case "QuoteMark": {
          if (isActive(from, to)) return;
          const end = text(to, to + 1) === " " ? to + 1 : to;
          out.push(hide.range(from, end));
          return;
        }
        case "ListMark": {
          if (isActive(from, to) || node.node.parent?.parent?.name !== "BulletList") return;
          // A task item shows only its checkbox.
          const task = /^\s\[[ xX]\]/.test(text(to, to + 4));
          out.push((task ? hide : Decoration.replace({ widget: new BulletWidget() })).range(from, task ? to + 1 : to));
          return;
        }
        case "TaskMarker": {
          if (isActive(from, to)) return;
          const checked = /x/i.test(text(from, to));
          out.push(Decoration.replace({ widget: new CheckboxWidget(checked, from) }).range(from, to));
          return;
        }
        case "HorizontalRule":
          if (!isActive(from, to)) out.push(Decoration.replace({ widget: new RuleWidget() }).range(from, to));
          return;
        case "FencedCode": {
          for (let pos = from; pos <= to; ) {
            const l = state.doc.lineAt(pos);
            out.push(line("cm-lp-codeblock").range(l.from));
            pos = l.to + 1;
          }
          return;
        }
      }
    },
  });
  return Decoration.set(out, true);
}

/** Live preview as one extension. Pass it inside a Compartment to switch to plain source. */
export function livePreview(options: LivePreviewOptions): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => build(state, options, false),
    update(value, tr) {
      if (tr.docChanged || tr.selection || tr.effects.length > 0 || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return build(tr.state, options, focusedOf(tr.state));
      }
      return value;
    },
    provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
  });
  return [focusState, field, focusTracker, previewTheme];
}

// Focus lives in state so the field can read it: blur renders every line.
const setFocus = StateEffect.define<boolean>();
const focusState = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setFocus) ? e.value : v), value),
});
const focusedOf = (state: EditorState) => state.field(focusState, false) ?? false;
const focusTracker = EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing));

/** Source highlighting for both views. No underlined headings (CodeMirror's default style). */
export const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "650" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "650" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, textDecoration: "underline", textUnderlineOffset: "2px" },
  { tag: [tags.url, tags.processingInstruction, tags.meta, tags.contentSeparator, tags.labelName], color: "var(--muted-foreground)" },
  { tag: tags.monospace, fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: "0.92em" },
  { tag: tags.quote, color: "var(--muted-foreground)" },
]);

const previewTheme = EditorView.baseTheme({
  ".cm-lp-frontmatter": { fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: "0.85em", color: "var(--muted-foreground)" },
  ".cm-lp-h": { fontWeight: "650", lineHeight: "1.3" },
  ".cm-lp-h1": { fontSize: "1.75em", paddingTop: "0.4em" },
  ".cm-lp-h2": { fontSize: "1.4em", paddingTop: "0.35em" },
  ".cm-lp-h3": { fontSize: "1.2em", paddingTop: "0.3em" },
  ".cm-lp-h4, .cm-lp-h5, .cm-lp-h6": { fontSize: "1.05em" },
  ".cm-lp-em": { fontStyle: "italic" },
  ".cm-lp-strong": { fontWeight: "650" },
  ".cm-lp-strike": { textDecoration: "line-through" },
  ".cm-lp-code": { fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: "0.9em", background: "var(--muted)", borderRadius: "4px", padding: "0 3px" },
  ".cm-lp-link": { color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: "2px" },
  ".cm-lp-quote": { borderLeft: "3px solid var(--border)", paddingLeft: "12px !important", color: "var(--muted-foreground)" },
  ".cm-lp-codeblock": { fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: "0.9em", background: "var(--muted)" },
  ".cm-lp-bullet": { display: "inline-block", width: "1ch", color: "var(--muted-foreground)" },
  ".cm-lp-task": { verticalAlign: "middle", margin: "0 4px 0 0", cursor: "pointer" },
  ".cm-lp-hr": { border: "none", borderTop: "1px solid var(--border)", margin: "0.6em 0" },
  ".cm-lp-image": { display: "block", maxWidth: "100%", maxHeight: "480px", margin: "6px 0", borderRadius: "6px" },
});
