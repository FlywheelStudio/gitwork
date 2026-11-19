# Doc round-trip fixtures

Every Gitwork doc editor (web: CodeMirror 6; Mac: TextKit 2) must pass these cases (decision 011).
The rule they guard: a file's bytes survive load → edit → save, and lines nobody edited stay
byte-identical.

`round-trip.json` holds `cases`. Each case has:

- `input`: the file as a JSON string (exact, including `\r`, `﻿`), or `inputBase64` for bytes
  that are not valid UTF-8.
- `editable: false`: the editor must refuse to edit the file (invalid UTF-8).
- `separator`: the line separator the editor must use (`"\r\n"` only when every break is CRLF).
- `ops`, applied in order:
  - `{ "find", "replace" }`: replace the first occurrence of `find`.
  - `{ "frontmatter": "set" | "add" | "remove", "key", "value" }`: a frontmatter panel edit.
    `expectNull: true` means the panel must refuse the edit (list, map, or missing key) and change nothing.
- `expected`: the file after the ops.

Each editor also checks that loading `input` and saving with no edit gives the same bytes.

Runners: `packages/core/src/docs/round-trip.test.ts` (string level) and
`apps/web/src/lib/doc-editor.test.ts` (through a CodeMirror `EditorState`).
