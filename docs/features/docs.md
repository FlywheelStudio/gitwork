# Docs on web — tree, rich-text editor, commits

Shipped 2026-11-19 (Phase 4, PR #16; whole-repo trees in `feature/docs-repo-tree`). Decisions 008, 011, 012, 035, 036, 037, 038.

## What it does
- **Docs** in the workspace sidebar shows each linked repo as a folder holding the repo's own
  structure: every tracked file (decision 038). An Admin can narrow a repo to one folder and pick
  its branch in Settings → Docs folders. Markdown files open in the editor; images and other files
  open through an access-checked proxy. Repos load on their own, with no button.
- The editor opens in **Rich text**: formatted text with markdown marks hidden off the cursor's
  line (decision 037). **Markdown** shows the plain source. A toolbar and ⌘B / ⌘I / ⌘S format and
  save. Frontmatter edits in a **properties panel**; lists and maps stay read-only there.
- **Save** is one signed commit on GitHub. The user's own token is used when they linked GitHub;
  otherwise the App commits with `Co-authored-by: <name> <email>` (decision 008).
- **Paste or drop an image**: it goes to `assets/` next to the doc and commits with the doc, linked by a
  relative path. Up to 10 MB each, 5 per save.
- **Conflicts**: if the doc changed on GitHub since it was opened, a side-by-side view shows
  GitHub's version and yours; save yours on top, keep editing, or take GitHub's.
- **Branch protection or review mode** turns a save into a pull request. The doc shows "Pending
  review"; later saves go to that pull request until it closes.
- **Presence**: "Max is editing this doc" while someone else has it open.
- **Create, rename, delete** from the tree and the doc header. Delete needs Admin.
- **Read Only** reads docs; files under the workspace's **hide folder** (Settings → What Read Only
  members see) never reach them: not in the tree, the API, images, or by URL.

## How it works

**Code.**
| File | Role |
|---|---|
| `packages/core/src/docs/paths.ts` | Path rules (`normalizeDocPath`, `normalizeRoot`, `resolveRelative`, `relativeLink`, `safeFileName`, `imageType`). |
| `packages/core/src/docs/text.ts` | Byte-exact text: base64, `bytesToText` (fatal UTF-8, BOM kept), `lineSeparatorOf`, `offsetToEditorPos`. |
| `packages/core/src/docs/frontmatter.ts` | `parseFrontmatter`, and set/add/remove as one-line text changes. |
| `packages/core/src/visibility.ts` | `isDocVisible()` and `docVisibilityContext()`: the hide-folder filter. |
| `packages/core/fixtures/docs/` | The shared round-trip fixtures (web and Mac). |
| `packages/server/src/github/docs.ts` | `readHead`, `planDocRootSync`, `readDocText`, `gitBlobSha`, `commitFiles`, PR helpers. |
| `packages/server/src/github/cache.ts` | Doc cache writers (`upsertDocRoot`, `upsertDocFiles`, `deleteDocFiles`, `putDocBlob`, `pruneDocBlobs`). |
| `packages/server/src/services/docs.ts` | List, read, raw files, presence, save/create/rename/delete, docs config, sync and prune. |
| `apps/web/src/lib/doc-editor.ts` | CodeMirror state with the file's line separator; `docText()` = `sliceDoc()`. |
| `apps/web/src/lib/live-preview.ts` | The rich-text view (decorations only) and the highlight style. |
| `apps/web/src/lib/markdown-commands.ts` | Toolbar edits: wrap, line prefix, link. |
| `apps/web/src/app/w/[workspaceId]/docs/` | Layout + tree (cache only), editor, properties panel, conflict view. |

**API (`/api/v1/workspaces/:id/…`).** `GET docs`, `POST docs/refresh`, `GET docs/file?repo&path`,
`PUT docs/file` (save; `docs/refresh` loads never-synced repos and any member may call it), `POST docs/file` (create), `POST docs/rename`, `DELETE docs/file?repo&path&sha`,
`GET docs/raw?repo&path`, `POST|DELETE docs/presence`, `PATCH github/repos/:repoNodeId/docs`,
`PATCH settings` (`hideFolder`, `reviewBotDocEdits`). Write routes check the role first.
`GET docs/file` works without the GitHub App while the text is cached.

**Write path (decision 036).** Read the file's current blob sha at the branch head → 409 with the
current text if it differs → `createCommitOnBranch` with `expectedHeadOid` (user token, App on
refusal) → re-read the root so the cache matches → audit row with the commit sha. A refusal with an
unchanged head and file means protection: branch + commit + pull request, and a
`doc_pending_prs` row.

**Sync (decision 035).** Roots are `<repo>:<branch>:<path>`. `push` webhook and reconcile run
`planDocRootSync`: one GraphQL call; a tree listing only when the folder's oid changed; a diff
against `gh_doc_files`. Text is fetched on first open and cached by blob sha.

## Data model
`workspace_repos.docs_path`, `.docs_branch`; `workspaces.hide_folder`, `.review_bot_doc_edits`;
`gh_doc_roots`, `gh_doc_files`, `gh_doc_blobs` (cache, rebuilt from GitHub); `doc_pending_prs`;
`doc_presence` (45-second heartbeat rows). Migration `0005_docs.sql`, additive only.
`0006_docs_whole_repo.sql` moves rows on the old `docs` default to `""` (the whole repo).

## External services
GitHub App permissions already in the manifest: Contents (rw), Pull requests (rw). Webhooks
`push` and `pull_request` (already subscribed) now do work. No new GitHub settings.

## Testing
- `packages/core/src/docs/*.test.ts`: paths, visibility, frontmatter, and the fixture suite.
- `apps/web/src/lib/doc-editor.test.ts`: every fixture through a CodeMirror `EditorState`, and
  line breaks in typed and pasted text. `markdown-commands.test.ts`: toolbar edits.
- `packages/server/test/docs.test.ts` (both drivers, fake GitHub with a git model): sync, filters,
  every write, attribution, conflicts, races, protection and review mode, presence, settings.
- `packages/server/test/api-docs.test.ts`: routes (success, 401, 403, 400, 409).
- `apps/web/e2e/docs.spec.ts`: tree, hide folder for Read Only, rich-text view, formatting,
  properties panel, single-key shortcuts inside the editor, save without the App.

## Gotchas
- **`doc.toString()` joins lines with LF** even in a CRLF file. Use `docText()` (`sliceDoc`).
  Test: `doc-editor.test.ts`.
- **With an explicit separator, CodeMirror does not split inserted text on other breaks.** The
  separator filter rewrites typed and pasted breaks. Test: `doc-editor.test.ts`.
- **`TextDecoder` drops a BOM by default.** `ignoreBOM: true` keeps it. Test: fixture `bom`.
- **The markdown parser reads frontmatter as a rule plus a setext heading.** Rich text hides the
  block; the panel edits it. Test: `docs.spec.ts`.
- **D1 allows 100 bound parameters per statement**; libsql allows more. Doc rows go in at 20 per
  statement. Test: "larger than one statement's bound parameters" (fails on D1 at 60).
- **SVG can carry script.** Raw files are served with `CSP: default-src 'none'; sandbox` and
  `nosniff`. Test: `docs.test.ts` reads.
- **A root of `""` is the whole repo.** Join paths with `joinRoot()`, never `${root}/…` (that gives a
  leading slash). Test: "whole repo" in `docs.test.ts`.
- **Relinking used to reset each repo's docs settings** (the link deletes and re-inserts
  `workspace_repos`). It now carries them over. Test: "keeps a repo's docs settings".
- **The hide folder matches whole segments and ignores case.** Test: `paths.test.ts`, `docs.test.ts`.
- **Unverified against real GitHub:** the protected-branch refusal of `createCommitOnBranch`, and
  10 MB images in one GraphQL request. Confirm in the live GitHub check.
