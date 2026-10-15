# 013 — Native Mac app

Date: 2026-10-15 · Status: Accepted

## Context
The owner wants an ultra-fast, light native app, like flo-state (AppKit + TextKit 2, Sparkle,
Homebrew cask).

## Decision
- AppKit shell, TextKit 2 docs editor, macOS 14+. Talks only to `/api/v1`.
- v1 scope: docs editor, task list, kanban. Timeline in 1.1.
- Sign-in: magic link opens the app through a custom URL scheme, or the user types the 6-digit code.
- Offline: tasks and docs read from a local cache. Doc edits save as local drafts and run the normal
  conflict check on reconnect. Task changes need a connection.
- Distribution: Developer ID signing, notarization, Sparkle updates, Homebrew cask.

## Alternatives considered
- **Web wrapper (WKWebView or Tauri):** one codebase, but not the speed the owner wants.

## Consequences
- The workspace standard says ULink for deep links. The magic-link URL scheme opens an installed
  app only and needs no attribution or deferred link, so ULink does not apply.
- The markdown round-trip fixture suite must also pass in Swift.
