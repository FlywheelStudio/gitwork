# 035 — Docs cache: tree by folder oid, text by blob sha

Date: 2026-11-19 · Status: Accepted (default; the owner may override) · Builds on 010, 011, 012

## Context
Pages never call GitHub (CLAUDE.md), so the doc tree must be in the database. A docs folder can
hold many files, D1 caps each statement at 100 bound parameters and each value at 2 MB, and push
payloads list at most 20 commits with file lists that can be stale.

## Decision
- **One docs folder per workspace repo.** `workspace_repos.docs_path` (default `docs`) and
  `docs_branch` (null = the repo's default branch). A cached folder is a "root": repo + branch +
  path. Two workspaces with the same settings share one root.
- **Tree.** One GraphQL call reads the branch head and the folder's tree oid
  (`object(expression: "<branch>:<path>")`). Only when the oid changed, one REST call lists the
  folder (`git/trees/<oid>?recursive=1`). The cache keeps path, blob sha, and size
  (`gh_doc_files`), diffed against the stored rows, at most 2,000 files per folder.
- **Text by blob sha** (`gh_doc_blobs`): content-addressed, so a row never goes stale. Fetched on
  first open (an API route, never a page render) and stored only when it is editable (valid UTF-8,
  at most 1 MB). Rows no file points at are pruned on every reconcile.
- **Updates.** The `push` webhook re-reads every root on the pushed branch; it ignores the
  payload's file lists. Reconcile re-reads the roots of each repo it syncs. A write re-reads its
  root right after the commit, so the editor and the tree never wait for the webhook.
- **Hide folder (012).** `workspaces.hide_folder`, relative to each docs folder, matched by whole
  path segments and without case. `isDocVisible()` in packages/core filters every list, read,
  image, presence call, and write path.

## Alternatives considered
- **Cache the whole repo tree:** simpler paths, but large repos would fill the database with files
  nobody can open.
- **Trust the push payload's added/modified/removed lists:** no extra call, but the lists are capped
  and miss force-pushes.

## Consequences
- A push to the docs branch costs one GraphQL call per root, plus a tree listing when the folder
  changed.
- A folder with more than 2,000 files shows a "more files than Gitwork lists" note.
- Files over 1 MB or not UTF-8 open read-only with a link to GitHub.
