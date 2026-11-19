# 037 — "Rich text" is a live preview over the source, not WYSIWYG

Date: 2026-11-19 · Status: Accepted (default; the owner may override) · Builds on 011

## Context
The owner asked for the docs folder in "the rich text doc editor". Decision 011 rejects WYSIWYG
editors (ProseMirror, Tiptap) because they re-serialize markdown and change lines nobody edited.

## Decision
- **The default view is "Rich text":** a CodeMirror 6 live preview. Headings, bold, italics, links,
  inline code, quotes, bullets, checkboxes (clickable), rules, and images render; markdown marks
  hide on every line the cursor is not on. The cursor's lines show the source. Frontmatter shows in
  a properties panel above the text.
- **"Markdown" view** shows the plain source with light highlighting. The choice is remembered per
  browser.
- **A toolbar and keys** (⌘B, ⌘I, headings, lists, checklist, quote, code, link, image) make small
  text edits on the selected lines only.
- **Bytes.** The editor always sets its line separator: CRLF when every break is CRLF, else LF, with
  a stray CR kept as text. Typed and pasted breaks take the file's separator. File text is read with
  `state.sliceDoc()`, never `doc.toString()` (which always joins with LF). The shared round-trip
  fixtures run through a real `EditorState`.

## Alternatives considered
- **Tiptap / ProseMirror WYSIWYG:** the most familiar feel, but it breaks the byte-exact guarantee
  (011) and the Mac app could not share the fixtures.
- **Source only:** safe, but not what the owner asked for.

## Consequences
- Tables and footnotes render as source for now.
- Navigating away inside the app with unsaved changes is not blocked; closing or reloading the tab
  asks first. Saves are explicit (each one is a commit), so there is no autosave.
