# TODO

Working tracker for the three product parts: Git GUI, surfaces grouped by C1 component, and knowledge that people and agents read first. `docs/04-roadmap.md` stays the phase record; this file is the live gap list.

Review date: 2026-11-19. Baseline: 58 tests, 7 surface detectors, 3 desktop tools.

Status words:

- **Done**: code, a test, and a caller exist.
- **Partial**: code exists but a user cannot finish the job.
- **Missing**: no code.

## Review summary

Shipped since the first TODO:

- C1 components: discovery, kind inference, assignment, grouping, filter, counts.
- Git change overlay on surfaces: `change.status`, `change.touched`, `--changed`.
- Three desktop tools: Git, Surfaces, Knowledge.
- One-step bootstrap: `reins bootstrap` and the `Cmd+K` action.
- OpenAPI JSON detector, deduplicated against code routes.
- Kind fixes: `bo` is backoffice, `portal` is webapp.
- S2 real graph link: surface symbols are verified against the Trail skeleton.
- G1 Git status and staging: status model, stage, unstage, discard with confirmation.
- G2 commit and history: commit, amend, sign-off, log, commit diff.

Top gaps, in user-value order:

1. **Git GUI stops at the working tree.** Status, stage, commit, log, branches, tags, worktrees, and git-appraise review listing work. No stash, merge, conflict resolution, push or pull, or full PR review.
2. **Detector coverage is narrow.** Seven detectors, all JS/TS plus Python FastAPI and OpenAPI JSON. No Go, Rust, Java, Ruby, PHP, C#, or mobile screens.
3. **Knowledge is not the first place to look.** No home, no drift detection, no authoring, no agent entry command.
4. **Review is a viewer, not a workspace.** Selecting a change does not drive the graph or knowledge panes. No comments, no promote.
5. **Surface detail is thin.** No handler, callers, flow, or linked notes next to a surface.

## UI shape

| Tool | Sub-views | State |
| --- | --- | --- |
| Git | Changes, Diff, Review, History, Reviews | Status, stage, unstage, commit, log, commit diff, branches, tags, worktrees, and git-appraise review listing work. |
| Surfaces | Entry points, Flow, Graph | Entry points grouped and filtered by component. Flow and Graph work for code surfaces. |
| Knowledge | Notes, Check | Read-only board and check report. |

Home stays the launcher. Deep links route into the owning tool and sub-view.

## Part 1: Git GUI

### Done

- Adapter: `info`, `status`, `resolveRange` for working, unstaged, staged, range, base, commit, `readAt`, `readWorking`, `readStaged`, `commitForPath`, `isTracked`.
- Status model: staged, unstaged, untracked, conflicted, line counts.
- Stage, unstage, discard with confirmation.
- Commit with message, amend, sign-off.
- Log with hash, author, date, subject, parent.
- Commit diff against the parent, root commit included.
- Semantic diff: moved, renamed, reformatted, extracted, inlined, reordered, added, removed.
- `DiffViewer`, `ReviewWorkspace`, CLI `reins diff` and `reins git`.
- Git tool with Changes, Diff, Review, History tabs and a Working, Staged, Base range selector.

### Partial

- **Review workspace.** Renders diff, graph, and knowledge, but the graph uses the first changed symbol and does not follow selection. No comments, no promote to knowledge.
- **History.** Log and commit diff work. No file history, no blame, no branch graph.
- **Safety.** Discard requires confirmation. No dry-run, no force-push guard, no conflict gate.

### Missing

- **Branches.** List, create, switch, delete, merge, ahead/behind.
- **Stash.** Push, pop, list, drop.
- **Conflicts.** Conflict list, take ours or theirs, resolve.
- **Remotes.** Fetch, pull, push, remote list. Network stays opt-in.
- **Pull request review.** Full PR model, base/head from a PR ref, review comments, approve or request changes, export. git-appraise review listing exists.

### Tasks

- [x] **G1 Status and staging.** Status model, stage, unstage, discard with confirmation. Proof: `reins git status --json` and tests. Hunk staging remains open.
- [x] **G2 Commit and history.** Commit, amend, sign-off, log, commit diff. Proof: `reins git log --json` and tests. File history and blame remain open.
- [ ] **G3 Branches and stash.** List, create, switch, delete, merge, stash push/pop/drop. Proof: `reins git branch --json` and a merge fixture test.
- [ ] **G4 Remotes and PR review.** Fetch, pull, push, PR refs, review comments, export. Proof: `reins pr review <n> --json` against a local bare remote.
- [ ] **G5 Conflicts and safety.** Conflict list, take ours/theirs, dry-run, force-push guard. Proof: a merge-conflict fixture test.
- [ ] **G6 Review selection.** Selecting a diff operation updates the graph and knowledge panes. Proof: desktop walkthrough.
- [ ] **G7 Review comments.** Comment on an operation or line, keep in session, export markdown, promote to inbox note. Proof: a test that promotes a comment.
- [ ] **G8 Commit picker.** Choose a commit or range from the Git tool instead of typing refs. Proof: desktop walkthrough.

## Part 2: Surfaces

### Done

- C1 components: discovery from `package.json` workspaces, `pnpm-workspace.yaml`, `Cargo.toml` members, `go.work`; kind inference; longest-prefix assignment; grouping; filter by id or kind; exact per-filter counts.
- Real graph link: surface symbols are verified against the Trail skeleton; a missing symbol becomes `symbolId: null` with `metadata.linkReason`. `flow` falls back to the symbol name.
- Change overlay: `change.status`, `change.touched`, `--changed`, `--range`.
- Seven detectors: Express, Hono, Commander, Next.js App Router, React Router, FastAPI, OpenAPI JSON.
- OpenAPI dedupe: a code route wins over the same method and route from a spec.
- Surface cache keyed by fingerprint and detector version, written only on a clean tree; watcher invalidates.
- CLI `surfaces --component`, `--changed`, `--range`.
- `SurfaceExplorer` groups by component, filters by component, shows changed badges.

### Partial

- **Graph link.** Code symbols are verified. OpenAPI `operationId` values are not code symbols, so those surfaces stay unlinked and flow reports the reason.
- **Detector engine.** Detectors are hardcoded in one file. SURF-7 asks for a registry where adding a detector is one line and one fixture.
- **OpenAPI.** JSON only, canonical filenames only, every surface points at line 1.
- **Surface detail.** No handler, callers, flow, or linked notes next to a surface.

### Missing

- **Cross-language detectors.** Go (net/http, gin, chi, echo, fiber), Rust (axum, actix, rocket), Java (Spring), Ruby (Rails), PHP (Laravel), C# (ASP.NET).
- **More JS frameworks.** Fastify, Koa, NestJS, Next pages router, TanStack Router, Remix, SvelteKit, Nuxt, Astro, Angular, Vue Router, tRPC, GraphQL, yargs, oclif.
- **Python.** Flask, Django, Starlette.
- **Mobile screens.** React Native, Expo Router, Flutter, SwiftUI, Compose.
- **OpenAPI YAML** and spec variants such as `openapi-admin.json`.
- **Package export surfaces.**
- **Surface detail panel.**

### Tasks

- [x] **S2 Real graph link.** Surface symbols are verified against the Trail skeleton. A missing symbol becomes `symbolId: null` with `metadata.linkReason`. `flow` falls back to the symbol name. Proof: `verifySurfaceSymbols` tests and a session scan.
- [ ] **S3 Detector registry.** Move detectors behind a registry with `id`, `version`, `filePatterns`, `detect`. Proof: adding a fixture detector requires one registry line and one test.
- [ ] **S4 Go and Rust detectors.** net/http, gin, chi, echo, fiber, axum, actix, rocket. Proof: one golden fixture per detector.
- [ ] **S5 Python and JVM detectors.** Flask, Django, Starlette, Spring. Proof: one golden fixture per detector.
- [ ] **S6 Ruby, PHP, C# detectors.** Rails, Laravel, ASP.NET. Proof: one golden fixture per detector.
- [ ] **S7 Mobile screens.** Expo Router, React Native, Flutter, SwiftUI, Compose. Proof: one golden fixture per detector.
- [ ] **S8 OpenAPI YAML and variants.** Parse YAML, detect `openapi-*.json`, point surfaces at the path key line. Proof: a YAML fixture and a line-number assertion.
- [ ] **S9 Surface detail.** Handler, callers, flow, and linked notes in one panel. Proof: desktop walkthrough.
- [ ] **S10 Detector golden fixtures.** One fixture repository and golden JSON per detector, as SURF-7 requires. Proof: `pnpm test` runs them.

## Part 3: Knowledge

### Done

- Markdown notes under `.reins/knowledge/` with types, status, tags, typed links, backlinks, mentions.
- OpenSpec import as read-only notes.
- `reins check` for invalid notes, broken links, unknown symbols and surfaces, constraint rules.
- Proposal inbox with atomic writes.
- `reins pack` harness pack and 12 MCP tools.
- Bootstrap: config, knowledge folders, graph, surfaces.
- `KnowledgeBoard` card view with a note detail pane.

### Partial

- **Check.** No drift detection. `SYMBOL_MOVED` exists in the check codes and is never emitted. A note does not know its symbol moved, its file changed, or its surface disappeared.
- **Board.** Read-only. No create, edit, accept, reject, or status transition. Drag positions are not persisted.
- **Backlinks.** Computed and not shown.
- **Constraints.** Only `forbidden-import` and `forbidden-call`.

### Missing

- **Knowledge home.** No view that answers "what is this project, what is changing, what must I not break" before code.
- **Agent entry.** No `reins context <intent>`, no generated agent brief, no per-component pack.
- **Note history.** Git history exists; the app does not link to the commit that last changed a note.
- **Per-component knowledge.** Notes are not grouped or filtered by C1 component.

### Tasks

- [ ] **K1 Knowledge home.** Brief, active changes, constraints, decisions, stale links, surfaces by component. Proof: desktop walkthrough and `reins context --json`.
- [ ] **K2 Drift detection.** Symbol moved or gone, file changed since the note, surface gone. Emit `SYMBOL_MOVED`. Proof: `reins check --scope knowledge+code` reports it on a fixture.
- [ ] **K3 Authoring.** Create, edit, accept, reject, status transitions. Proof: a test that accepts a proposal and moves the file.
- [ ] **K4 Agent entry.** `reins context <intent>`, generated `AGENTS.md` knowledge section, per-component pack. Proof: `reins context "add a refund"` under the token cap.
- [ ] **K5 Backlinks and note detail.** Show backlinks and linked symbols, surfaces, and files. Proof: desktop walkthrough.
- [ ] **K6 Constraint coverage.** Add `forbidden-path`, `required-file`, and naming rules with pass, fail, and not-applicable. Proof: fixture tests for each rule.
- [ ] **K7 Persist board positions.** Store positions in local state, not in the note. Proof: reload keeps positions.

## Cross-cutting

- [ ] **T1 UI tests.** No component tests exist. Add a memory client and render tests for the three tools.
- [ ] **T2 Performance.** `listSurfaces` runs `git info` on every call; `SurfaceExplorer` runs a Git diff on every filter change. Measure and cache.
- [ ] **T3 Path quoting.** `changedLines` does not handle quoted paths with spaces. Proof: a fixture with a space in a filename.
- [ ] **T4 Doc drift.** `docs/04` Phase 2 "not in scope" still lists OpenAPI import, which now ships. Reconcile.
- [ ] **T5 Benchmark record.** No recorded run for the scan and diff budgets in `docs/02`. Record one.
- [ ] **T6 Destructive Git safety.** When G1 lands, every destructive operation needs a confirmation gate and a dry-run.

## Order

1. **K1 and K2** next. The knowledge home and drift detection make knowledge the first place to look.
2. **G3 and G4** next. Stash, push and pull, and PR review complete the Git GUI.
3. **S3 and S4** next. The registry, then Go and Rust, the largest missing language groups.
4. **G5**, then **K3 to K7**, then **S5 to S10**.
5. **T1 to T6** alongside the milestone that needs them.

## Verification

Run before closing any task:

```bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc -p packages/core/tsconfig.json --noEmit
./node_modules/.bin/tsc -p packages/node/tsconfig.json --noEmit
./node_modules/.bin/tsc -p packages/ui/tsconfig.json --noEmit
./node_modules/.bin/tsc -p apps/cli/tsconfig.json --noEmit
./node_modules/.bin/tsc -p apps/desktop/tsconfig.json --noEmit
./node_modules/.bin/biome check packages apps
```

`pnpm` is not installed on this machine. Use the local binaries above, or `npx pnpm@10` with the local store.
