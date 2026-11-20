---
title: Scope Trail callers to the symbol file when names collide
author: Tue
date: 2026-11-20
branch: main
id: l-7993dd5b
scope: repo
status: active
src: agent
touches:
  - AGENTS.md
  - README.md
  - RULES.md
  - apps/cli/src/main.ts
  - apps/cli/src/serve.ts
  - apps/desktop/package.json
  - apps/desktop/src-tauri/icons/icon.png
  - apps/desktop/src-tauri/src/lib.rs
  - apps/desktop/src-tauri/tauri.conf.json
  - apps/desktop/src/renderer/App.tsx
---

## Decided
- Pass `--in <file>` to `trail callers` when the symbol id contains `#`. A bare name like `Page` matches the first symbol with that name, so every Next.js page surface resolved to the same root and the flow showed one wrong file.
- In the code: `packages/node/src/trail.ts` `callers()`, `packages/node/src/session.ts` `flow()`.

## Tried and ruled out
- Passing the full `path#symbol` id to `trail callers`: Trail rejects it with "no symbol ... in the graph".
- Relying on the call graph alone for React components: Trail has no JSX call edges, so `flow` falls back to the entry file imports.
