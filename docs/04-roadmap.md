# 04. Roadmap

Six phases. Each phase ends with a demo that can fail, a gate that can be measured, and a written list of what was intentionally left out. Phase 1 is the one that must not be compressed: it fixes the module boundaries, error model, test harness, and code budget that every later phase inherits.

Estimates assume one developer working with a coding agent, part time. They are ranges, not commitments.

## 1. Phasing rules

- **Vertical slices only.** A phase ships a working path from UI or CLI to the adapter, not a layer of infrastructure with no caller.
- **One adapter per external system.** Trail, Git, and the AST parser each have exactly one module that knows their formats.
- **No phase depends on a later phase's contract.** If a later requirement needs a field, add it now as optional or leave it out.
- **A gate is a command or a recorded demo.** "Looks good" is not a gate.
- **Code budget is part of the gate.** LOC and dependency counts are checked at every phase exit.
- **Docs move with code.** A phase is not done until its spec and this roadmap match what exists.
- **No parallel phase work.** Finish or explicitly cut the current phase before starting the next. Exceptions are limited to a spike with a timebox, recorded in `07`.

## 2. Implementation status

| Phase | Status |
| --- | --- |
| 0 | Done. |
| 1 | Done. |
| 2 | Done for Express, Hono, Commander, Next.js App Router, React Router, FastAPI. |
| 3 | Done for TypeScript, TSX, JavaScript, JSX; Python degrades to line diff. |
| 4 | Done, including OpenSpec import. |
| 5 | Done: review workspace, embeddable components, MCP tools, harness pack. |
| 6 | Partial: packaging, Windows/Linux, OpenAPI YAML import, Expo, LLM enrichment remain; the file watcher ships. |
| 7 | Implemented: knowledge tree, studio, lexical index, bootstrap, coverage, git-notes comments. Performance budgets are unrecorded. |

## 3. Overview

| Phase | Title | Duration | Depends on | Primary risk |
| --- | --- | --- | --- | --- |
| 0 | Specification and decisions | done | none | Scope drift before code |
| 1 | Foundation and vertical slice | 2 to 3 weeks | 0 | Overbuilding the skeleton; adapter assumptions |
| 2 | Surfaces and graph exploration | 2 to 3 weeks | 1 | Detector coverage and false links |
| 3 | Semantic diff | 2 to 4 weeks | 1 | Matcher accuracy; parser coverage |
| 4 | Knowledge ledger | 2 to 3 weeks | 1, 2 | Link validation cost; over-modeling node types |
| 5 | Review workspace and embed | 2 to 3 weeks | 2, 3, 4 | Three-pane state complexity; host API leaks |
| 6 | Hardening and full agent layer | 2 to 4 weeks | all | Performance and platform packaging |
| 7 | Knowledge tree and studio | 2 to 3 weeks | 4 | Migration cost; template bureaucracy |

Total: roughly 12 to 20 weeks of focused work. Phases 2, 3, and 4 are independent after Phase 1 and may be reordered if a real user pulls one forward. The default order is deliberate: surfaces first because they produce the most user value per line, diff second because it validates the parser path, knowledge third because it needs surfaces to link against.

## 4. Phase 0: Specification and decisions

**Outcome.** This document set. No code.

**Exit gate.**

- Product spec, architecture, data contracts, roadmap, Phase 1 plan, AI harness, and decisions are written and reviewed.
- Every open question has an owner or a decision date.
- The Phase 1 module list, dependency whitelist, and exit criteria are fixed.
- The Trail spike has produced real JSON samples and a version compatibility note. Done during Phase 0: callers, search, skeleton, status, and build-check outputs were captured from Trail 0.28.0 and are recorded in `03`.

**Explicitly not in Phase 0.** No `package.json`, no scaffolding, no prototype code. A scaffold written before the module boundaries are agreed becomes the architecture by accident.

## 5. Phase 1: Foundation and vertical slice

**Goal.** A codebase small enough to read in an afternoon, with one complete path that proves every boundary: open a repository, verify the Trail graph, search a symbol, load callers, render them, and open a source location.

**Ships.**

- pnpm workspace with three packages and two apps, strict TypeScript, Biome, Vitest, GitHub Actions.
- `@reinss/core`: config schema, error model, API types, graph normalization, fingerprint, revision.
- `@reinss/node`: Trail adapter over JSON, repo session, path safety, process runner, in-memory cache.
- `reinss` CLI: `init`, `status`, `search`, `callers`, `callees`, `graph`, `mcp` with three tools.
- Tauri app: repository picker, status strip, symbol search, callers graph, open in editor.
- `@reinss/ui`: `ReinsProvider`, `GraphView`, `RepoStatus`, one token stylesheet.
- Test harness: three fixture repositories, fake Trail binary, real Trail integration test behind a flag, recorded JSON fixtures, boundary check.
- `AGENTS.md` and two project skills.

Detailed plan: [05. Phase 1 foundation](05-phase-1-foundation.md).

**Not in scope.** Surfaces, semantic diff, knowledge nodes, watcher, packaging for distribution, LLM anything, tldraw, custom elements.

**Exit gate.**

- [ ] `pnpm install --frozen-lockfile && pnpm check` passes on a clean clone on macOS.
- [ ] `pnpm --filter @reinss/desktop build` produces a launchable app; the smoke test launches it and finds the window.
- [ ] `reins init` creates the config and knowledge folders, and refuses to overwrite an existing config.
- [ ] Open `test/fixtures/graph-basic`, see `ready` with the correct node count.
- [ ] Search `total` and see symbol results with file:line.
- [ ] Open callers for `add`, see `total` at depth 1, expand to depth 2, confirm graph edges.
- [ ] `reins callers add --json` validates against the contract fixture.
- [ ] `reins mcp` responds to `reins_status`, `reins_symbols`, and `reins_callers`.
- [ ] Production source (excluding tests, fixtures, generated) is at most 5,000 lines.
- [ ] Runtime dependencies are at most 12, each on the whitelist.
- [ ] The graph query p95 is at or under the Phase 1 budget on the large fixture (250 ms at depth 2).
- [ ] Boundary test fails when a deliberate `node:fs` import is added to `@reinss/ui`.

**Risk.** The Trail adapter is the only place where an external JSON shape is trusted. Mitigation: record fixtures for every supported Trail version, validate with zod, and run a real-Trail test in CI when Trail is installed.

## 6. Phase 2: Surfaces and graph exploration

**Goal.** Turn a graph query tool into a product answer: "here are the entry points users reach, and here is the flow behind this one."

**Ships.**

- Detector engine, registry, and prefilter.
- Detectors: Express, Hono, Commander, Next.js App Router, React Router.
- Surface cache keyed by fingerprint plus detector versions.
- `SurfaceExplorer` component with filters and grouping.
- `GraphView` enhancements: direction both, depth control, filters by path and language, expand one hop, node details, editor reveal.
- CLI: `reins surfaces`, `reins flow`, `reins graph --direction both`.
- MCP: `reins_surfaces`, `reins_flow`.
- Surface linking rules and diagnostics for unresolved handlers.
- C1 component discovery and grouping, plus the Git change overlay on surfaces.
- Migration of the graph renderer to handle 1,500 nodes with aggregation.

**Not in scope.** FastAPI, Expo, OpenAPI import, package export surfaces, large-graph Sigma mode.

**Exit gate.**

- [ ] Fixtures for all five detectors produce golden surface JSON with no false handler links.
- [ ] Every surface in the fixtures either has a real Trail node ID or a recorded reason.
- [ ] `reins flow "GET /api/users"` returns handler to depth 3 with file:line.
- [ ] Scanning 5,000 files completes in 3 s or less on the benchmark machine.
- [ ] Surface scan is idempotent: two runs produce byte-identical JSON.
- [ ] A broken detector is isolated and reported, and the scan still completes.
- [ ] The desktop can navigate from a route to its handler to callers without leaving the app.
- [ ] No surface detector imports `fs` or reads files directly.

**Cut line.** If detector work expands, ship Express, Next.js, and Commander. Hono and React Router move to Phase 6. Do not ship a detector without a fixture.

## 7. Phase 3: Semantic diff

**Goal.** Replace line diff with structural change for the common refactor operations, with an honest fallback when parsing fails.

**Ships.**

- `@babel/parser` implementation for TypeScript, TSX, JavaScript, and JSX.
- Parser worker in the Node sidecar and a Node worker for the CLI.
- Matcher: exact subtree hash, parent and name matching, structural similarity, extraction and inlining, reorder detection.
- Git range resolution for working tree, staged, range, and base.
- `DiffViewer` with operation list, split and stacked views, degraded line fallback.
- CLI: `reins diff <range>` with JSON, `reins diff --file`.
- MCP: `reins_diff`.
- Diff cache keyed by blob hashes, parser version, matcher version.
- Operation navigation and keyboard support.

**Not in scope.** Watch mode, comments, knowledge promotion, LLM summaries, languages beyond TypeScript, TSX, JavaScript, JSX.

**Exit gate.**

- [ ] A fixture where a function moves between files is reported as one `moved`, not add plus delete.
- [ ] A fixture where a function is renamed with an unchanged body is reported as `renamed`.
- [ ] A reformat-only change (prettier run) produces `reformatted` and zero `modified`.
- [ ] A real extraction produces `extracted` with `high` or `medium` confidence and a reason.
- [ ] JSON output is byte-identical across two runs and across the Node sidecar and CLI.
- [ ] A 1,000-line file diffs in 300 ms p95 and a 5,000-line file in 1 s p95 on the benchmark machine.
- [ ] An unsupported language and a file over the cap both degrade with a visible reason, with no crash and no false operations.
- [ ] Git staged, working tree, and commit range each produce the expected resolved commits.
- [ ] False move rate on the evaluation fixture is under 5%.

**Risk.** Matcher accuracy is the highest technical risk in the product. Mitigation: keep the op set small, evaluate against a labeled fixture of 30 real refactors, and prefer a low-confidence label over a wrong high-confidence one. If accuracy misses the gate after two iterations, ship move and rename only and defer extraction and inlining.

## 8. Phase 4: Knowledge ledger

**Goal.** Make intent a first-class, committed artifact that links to code and can fail a check.

**Ships.**

- Note parser, schema validation, ID rules, typed links, backlinks, mentions.
- Knowledge index cache with mtime and content hashing.
- Note repository with atomic writes and proposal inbox.
- Knowledge card view with local positions, replaced by the Studio tree in Phase 7.
- Note editor: markdown text area with preview. No rich-text editor in this phase.
- CLI: `reins propose`, `reins knowledge get <address>`, `reins check`.
- MCP: `reins_knowledge_search`, `reins_knowledge_get`, `reins_knowledge_propose`, `reins_check`.
- Constraint evaluation for `forbidden-import` and `forbidden-call`.
- Code link verification through Trail skeleton, batched by file.

**Not in scope.** Promoting review comments (Phase 5), LLM-drafted notes, note history UI, multi-user review, drag-and-drop file management.

**Exit gate.**

- [ ] A note with an invalid field fails with `NOTE_INVALID`, the path, and the field.
- [ ] A broken node link, unknown symbol, and unknown surface each appear as distinct check codes.
- [ ] `reins check` on the knowledge fixture completes in 1 s without code verification and 4 s with it.
- [ ] Accepting a proposal moves it out of `inbox/`, sets `accepted`, and produces a Git diff only for that file.
- [ ] The board renders 100 notes and 200 links without dropping below 30 fps in the recorded session.
- [ ] Editing a node updates backlinks within 300 ms after save.
- [ ] Constraint rules produce pass, fail, and not-applicable outcomes on the diff fixtures.
- [ ] No note content is stored only in a cache or a database.

## 9. Phase 5: Review workspace and embed

**Goal.** One workspace where a reviewer sees structural change, graph context, and governing knowledge together, and one embed contract that a host can actually use.

**Ships.**

- `ReviewWorkspace` with three synchronized panes and operation-level navigation.
- Comments on operations and lines, stored locally for the session, exportable as markdown.
- Promote comment to knowledge draft.
- Deep links: `reins://symbol/<id>`, `reins://surface/<id>`, `reins://diff?range=...`, `reins://note/<id>`.
- Embed package polish: client interface, theme tokens, empty and error states, custom element build.
- Example host app with a plain React mount and a tldraw shape mount.
- MCP completion: `reins_harness_pack`, token caps, progress notifications, tool annotations.
- Documentation site section for embedding.

**Not in scope.** Multiplayer, remote comments, PR provider integration, VS Code extension (example only), collaborative canvas.

**Exit gate.**

- [ ] Selecting a diff operation updates the graph pane and the knowledge pane in one click.
- [ ] Promoting a comment creates an inbox note with correct links and a reviewable diff.
- [ ] Every component renders in the host example with a memory client and no Tauri presence.
- [ ] The tldraw example mounts `GraphView` and `DiffViewer` as shapes with navigation wired to the host router.
- [ ] All components pass the keyboard and contrast checklist.
- [ ] `reins_harness_pack` returns a deterministic pack under 4,000 estimated tokens for the evaluation intent.
- [ ] Deep links open the correct view after a cold app start.

**Risk.** The three-pane layout can grow state complexity. Mitigation: one selection object per workspace, no cross-pane stores, and a single reducer with tests. If the panes cannot share one selection cleanly, cut the knowledge pane and link out.

## 10. Phase 6: Hardening and full agent layer

**Goal.** Make it hold under real repositories, real platforms, and real agent sessions.

**Ships.**

- File watcher for code and knowledge, with debounce and targeted invalidation.
- Performance passes against all budgets on a real 100k LOC and 1M LOC repository.
- Windows and Linux builds, signing and notarization for macOS.
- FastAPI, Expo, OpenAPI YAML import, and package export surfaces.
- `reins_harness_pack`, agent evaluation suite, and the remaining project skills.
- Optional LLM enrichment: surface summaries, note drafts, diff explanations, all opt-in and labeled.
- Import from `.boardry/` and `DESCRIPTION` style docs as a one-way migration helper.
- Release: npm packages, changelog, upgrade notes, documentation site.
- Fuzz and property tests for note parsing, path containment, and operation matching.

**Not in scope.** Hosted service, accounts, team sync, multiplayer, mobile app, code editing.

**Exit gate.**

- [ ] All budgets in `02` pass on the benchmark corpus with a recorded run.
- [ ] macOS, Windows, and Linux installers launch and open a repository.
- [ ] A 1M LOC repository opens with a warm graph in 3 s and answers depth 2 in 500 ms p95 on that larger corpus (the 200k-node budget in `02` remains 250 ms).
- [ ] Watcher updates a changed file's diff in 500 ms or less without losing scroll position.
- [ ] Agent evaluation shows fewer tool calls and fewer tokens than the Trail-only baseline on at least 4 of 6 tasks, with no task scoring worse on correctness.
- [ ] Upgrade from the previous cache schema requires no user action.
- [ ] Documentation covers install, repository setup, embed API, MCP tools, and knowledge authoring.

## 11. Phase 7: Knowledge tree and studio

**Goal.** Make knowledge mirror the repository, writable by a person and readable by an agent in milliseconds, with no model and no network.

**Ships.**

- Node tree under `.reins/knowledge/`, `template.md` layers, `_` guidance files, per-directory index hints.
- Studio: component tree, node editor, search, coverage, comments.
- Lexical index with BM25, aliases, intent routing, and a disposable JSON cache.
- `reinss ask`, `reinss knowledge init|new|get|search|context|check|coverage|migrate|comment`, `reinss studio`.
- Bootstrap from the Trail graph, coverage per component, Git-notes comment threads.
- Built-in templates: `default`, `minimal`, `c4`, `domain`.
- Opt-in AI drafting in `knowledge init --ai`, disabled by default and limited to proposed nodes.
- Settings page with local provider discovery, and an Initialize flow inside the Studio.
- MCP tools `reins_knowledge_search`, `reins_knowledge_get`, `reins_knowledge_context`, `reins_knowledge_coverage`, and the unchanged proposal write path.
- The `reins-knowledge` skill and ADR-021, ADR-022.

**Not in scope.** Embeddings, LLM calls, SQLite, a second knowledge store, full `index.yaml` grouping semantics, cross-machine sync.

**Exit gate.**

- [ ] `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- [ ] `reinss knowledge check` passes on a migrated repository with no template errors.
- [ ] Cold build, warm build, query p95, and context pack size are measured on the recorded machine and recorded in `openspec/changes/add-knowledge-studio/design.md`.
- [ ] A bootstrap on a fixture repository writes only `proposed` nodes and changes nothing outside `.reins/knowledge/`.
- [ ] The studio is exercised in the desktop app, or the reason it could not be is stated.

## 12. Requirement traceability

| Requirement group | Phase introduced | Phase completed |
| --- | --- | --- |
| REPO-1 to REPO-5 | 1 | 5 |
| REPO-6 | 2 | 6 |
| GRAPH-1 to GRAPH-4 | 1 | 2 |
| GRAPH-5 to GRAPH-7 | 2 | 6 |
| SURF-1 to SURF-5 | 2 | 3 |
| SURF-6, SURF-8 | 6 | 6 |
| SURF-7 | 2 | 2 |
| GIT-1 to GIT-5 | 6 | 6 |
| SURF-9 | 2 | 2 |
| SURF-10 | 2 | 2 |
| DIFF-1 to DIFF-9 | 3 | 4 |
| DIFF-10 to DIFF-12 | 6 | 6 |
| KNOW-1 to KNOW-8 | 4 | 5 |
| KNOW-9 | 5 | 5 |
| KNOW-10 | 4 | 4 |
| KNOW-11 | 6 | 6 |
| KNOW-12 to KNOW-14, KNOW-16 | 7 | 7 |
| KNOW-15 | 7 | 7 |
| KNOW-17, KNOW-18 | 7 | 7 |
| KNOW-1, KNOW-5, KNOW-7 (tree revision) | 7 | 7 |
| REV-1 to REV-3 | 5 | 5 |
| REV-4 to REV-5 | 6 | 6 |
| EMBED-1 to EMBED-4 | 5 | 5 |
| EMBED-5 to EMBED-7 | 5 | 6 |
| CLI-1 to CLI-3 | 1 | 1 |
| MCP-1 to MCP-2 | 1 | 5 |
| MCP-3 | 5 | 6 |

## 13. Phase exit routine

Run at the end of every phase:

1. Run the gate commands on a clean checkout and record the output in the phase notes.
2. Record the benchmark run with machine, commit, node count, and p50/p95.
3. Update `01`, `02`, `03`, and this roadmap for anything that changed.
4. Add every deferred item to the "not in scope" list of the phase that owns it. Do not leave it in a chat thread.
5. Delete dead code and unused dependencies. The code budget is checked before the phase is declared done.
6. Run the agent tasks for the phase and record tool calls and token counts.
7. Tag the commit `phase-<n>` after the gate passes.

## 14. Stop and pivot criteria

Stop the current phase and reconsider when any of these hold:

- Trail's JSON cannot be validated across two recent versions without scraping text. Pivot: pin one Trail version and ship it as a bundled dependency, or contribute a JSON contract upstream before continuing.
- The semantic matcher cannot exceed 80% precision on moves and renames after two iterations. Pivot: ship diff as a viewer over an existing engine and drop extraction detection.
- A phase exceeds twice its estimate without hitting more than half of its gate. Cut scope to the gate's must-have lines and move the rest to the next phase.
- The desktop app cannot hold the memory budget after the graph renderer work. Pivot: move the renderer to a separate window process or reduce the live node cap.
- A required dependency changes license or stops being maintained. Re-evaluate against the whitelist in `07`; do not add a replacement in the same phase without a decision record.

## 15. What stays constant across phases

- One graph source: Trail.
- One API: `ReinsApi` in core.
- One knowledge source: committed markdown, including read-only OpenSpec.
- One diff engine: the AST matcher.
- No network by default.
- No code execution from the repository.
- Every phase leaves a smaller or equal dependency count per feature, or records why it grew.
