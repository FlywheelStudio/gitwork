# 028 — One keymap; Linear's default keys

Date: 2026-11-10 · Status: Accepted (owner)

## Decision
- `packages/core/src/keymap.ts` holds every shortcut as data. The web app and the Mac app read it.
- Defaults follow Linear (`Cmd+K`, `/`, `?`, `C`, `G` then a letter, `J`/`K`, `X`, `S`, `P`, `A`,
  `L`, `I`, `E`). Check each against Linear's in-app list before the keymap is frozen.
- Single-key shortcuts never fire in an input, a textarea, or the code editor.

## Consequences
- A unit test fails on two commands with the same keys in one scope.
