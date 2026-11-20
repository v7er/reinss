---
title: Homepage is only quick actions and cmd+K
author: Tue
date: 2026-11-18
branch: main
id: l-6fb07af9
scope: repo
status: active
src: agent
touches:
  - README.md
  - RULES.md
  - apps/cli/src/serve.ts
  - apps/desktop/package.json
  - apps/desktop/src-tauri/icons/icon.png
  - apps/desktop/src-tauri/src/lib.rs
  - apps/desktop/src-tauri/tauri.conf.json
  - apps/desktop/src/renderer/App.tsx
  - apps/desktop/src/renderer/app.css
  - apps/desktop/src/renderer/client.ts
---

## Decided
- The home screen is one list of tool quick actions (icon, label, description) ordered by recent use, plus a ⌘K hint. No repo header, health cards, or knowledge panels.
- One TOOLS list in `apps/desktop/src/renderer/App.tsx` feeds both the home list and the ⌘K palette, so labels and icons stay identical.
## Watch out
- Recent tools live in localStorage under `reins.recentTools`; `status` is filtered out of the home list so Home does not list itself.
