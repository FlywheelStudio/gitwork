# 011 — Docs editing model

Date: 2026-10-15 · Status: Accepted

## Context
Docs must stay plain markdown in git, with clean diffs, editable on web and Mac.

## Decision
- **Scope:** `docs/**/*.md` is editable; the folder is configurable per repo. Images, PDFs, and other
  files in the folder are view/download only. Files outside the folder are not shown.
- **Fidelity:** untouched lines stay byte-identical. Both editors edit source text and hide syntax
  marks on display (web: CodeMirror 6; Mac: TextKit 2), as flo-state does. No WYSIWYG
  re-serialization. A shared fixture suite tests both.
- **Frontmatter:** an editable properties panel. Unknown keys are kept as they are.
- **Images:** paste or drag commits the image to `docs/assets/` in the same commit as the doc save,
  linked by relative path. The server proxies images after the same access check. Limit 10 MB.
- **Concurrency:** one writer at a time. The app shows "Jane is editing". A save sends the file's
  blob SHA; if the file changed, the save fails and the app shows a merge view.
- **Branch:** commit to the default branch (configurable per repo). If branch protection blocks a
  direct commit, open a pull request and mark the doc "pending review".
- **Rename/move:** one commit, so git follows the file. Delete needs Admin.

## Alternatives considered
- **Live co-editing (Yjs + Durable Objects):** heavy for the native editor. Deferred.
- **WYSIWYG editor (ProseMirror/Tiptap):** re-serializes markdown and breaks fidelity.

## Consequences
- Multi-file commits (doc + image, rename) use the Git Data API or `createCommitOnBranch`.
