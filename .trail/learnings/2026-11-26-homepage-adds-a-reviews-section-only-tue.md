---
title: Homepage adds a reviews section only when reviews need you
author: Tue
date: 2026-11-26
branch: main
id: l-4675547b
scope: repo
status: active
replaces: l-6fb07af9
src: agent
touches:
  - README.md
  - apps/cli/src/serve.ts
  - apps/desktop/src/renderer/App.tsx
  - docs/01-product-spec.md
  - docs/03-data-contracts.md
  - packages/core/src/types.ts
  - packages/node/src/git.test.ts
  - packages/node/src/git.ts
  - packages/node/src/session.ts
  - packages/ui/src/index.ts
---

## Decided
- Keep the homepage as the tool quick-action list, and add one conditional section below it for open git-appraise reviews that need the current user. The section renders only when at least one review matches, so a repository without reviews keeps the old single-list home.
- Read git-appraise data from `refs/notes/devtools/reviews` and `refs/notes/devtools/discuss` with `git notes`, not by running the `git-appraise` binary. The feature is optional and disappears when the notes ref is absent.

## Tried and ruled out
- Requiring the `git-appraise` binary: it would add a second child process and make the feature unavailable to users who only have the notes.

## Watch out
- `needsReview` excludes reviews requested by the current user and reviews whose reviewer list does not include the current user. `git config user.email` is the identity source.
- In the code: `packages/node/src/git.ts` `reviews()`, `apps/desktop/src/renderer/App.tsx` `HomeTool` and `GitReviewList`.
