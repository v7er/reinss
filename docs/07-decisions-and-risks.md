# 07. Decisions and risks

Accepted decisions are binding until a new decision record supersedes them. Rejected ideas stay here so they are not re-litigated in every design review.

## 1. Decision records

### ADR-001 Tauri with a Node sidecar for the desktop shell

**Status:** accepted. Supersedes the earlier Electron decision.

**Context.** The core is TypeScript and must run in the CLI, the desktop app, and the MCP server. The desktop needs a native window, a folder picker, filesystem access, child processes, editor reveal, and a React renderer. Tauri gives a small Rust shell and the system webview, but it does not run the Node core.

**Options.**

- Electron: one runtime, the Node core runs in the main process, but a large binary and a bundled Chromium.
- Tauri with a Node sidecar: small shell and system webview, one Node process per repository, one extra stdio hop.
- Tauri with Rust for files, Git, and the graph: smallest binary, but a second implementation of every adapter and the diff engine.

**Decision.** Tauri with a Node sidecar. Rust owns the window, the native dialog, and the sidecar lifecycle. The sidecar is `apps/cli/dist/serve.js`, shares `RepoSession` with the CLI and MCP, and speaks newline-delimited JSON over stdin/stdout. The renderer uses `@tauri-apps/api` invoke.

**Consequences.** The desktop binary is smaller and uses the system webview. The domain code stays in one language and one implementation. The cost is a Node runtime on the machine and one process to supervise. The MVP uses the system `node`; packaging a Node binary is a Phase 6 task. Rust commands are thin: validate, forward, return the envelope. No graph, diff, or knowledge logic in Rust.

**Revisit when.** Shipping a Node runtime becomes a distribution blocker, or the sidecar hop misses the latency budget. The fallback is a Rust implementation of the adapters, not a return to Electron.

### ADR-002 Trail is a CLI dependency, not a fork

**Status:** accepted.

**Context.** Trail owns parsing, language coverage, node identity, and the graft format. Reins needs all of it and none of the maintenance.

**Decision.** Depend on the `trail` binary. Call documented commands with `--json`. Validate the JSON. Never read `graft/` internals, never modify Trail's storage, never parse human-readable output.

**Consequences.**

- Reins inherits Trail's language coverage and update cadence.
- Trail's JSON becomes a compatibility surface. Version range, fixtures, and a clear error code are mandatory.
- Claude Code skills and Trail's learnings remain usable alongside Reins.
- If Trail later ships a library API, the adapter implementation changes and `TrailPort` stays.

**Rejected.** Forking Trail to add surfaces or a stable JSON layer. That forks the parser, the graph format, and the release cycle.

**Revisit when.** Trail's JSON cannot be stabilized across two minor versions, or Trail stops being maintained and a maintained fork exists.

### ADR-003 One graph source, no second database

**Status:** accepted.

**Context.** A local graph store is tempting for search, joins, and large traversals. The reference implementation used a compiled SQLite graph, and that design works when the indexer is yours. Here the indexer is Trail.

**Decision.** No copy of the graph. Reins computes slices from Trail JSON and caches only derived, disposable artifacts in JSON. No SQLite in Phase 1 through Phase 5.

**Consequences.**

- Node identity never drifts between two stores.
- Search delegates to Trail. Reins adds scoring only for notes, which are small.
- A future full-text index over notes can use a small in-memory structure or SQLite, but it must never duplicate the graph.
- Query performance is bounded by Trail's own query performance.

**Revisit when.** A measured user flow needs a join that Trail cannot answer and the join cannot be computed from one slice.

### ADR-004 Three packages, two apps, no task runner

**Status:** accepted.

**Context.** A monorepo tends to grow packages faster than it grows value. The reference repositories carried schema, query, export, sdk, and ui packages, plus a docs app.

**Decision.** `core`, `node`, `ui`, `apps/cli`, `apps/desktop`. No schema package, no protocol package, no MCP package. `pnpm -r` instead of turbo. Add a task runner only when CI time proves the need.

**Consequences.** Every package has a real consumer and a clear responsibility. The boundary test, not folder names, enforces the architecture. Build order comes from workspace dependencies.

**Revisit when.** Build time exceeds 3 minutes on CI or a third consumer appears for a package that is currently internal.

### ADR-005 Pure core and one API

**Status:** accepted.

**Context.** Every transport (CLI, Tauri, MCP, HTTP for a host) tends to grow its own logic. The result is three subtly different answers to the same question.

**Decision.** Define `ReinsApi` once in core. Every transport validates, dispatches, and serializes. Domain rules live only in core or in the session implementation.

**Consequences.** A feature is not "done" until all transports expose it. Contract tests run per transport. The UI never sees a transport-specific shape. The one exception is `revealInEditor`, a host capability that is not a repository query.

**Revisit when.** A transport needs streaming semantics that the API cannot express. Even then, add an event type to the API rather than a separate code path.

### ADR-006 Babel parser and an owned matcher

**Status:** accepted.

**Context.** Semantic diff needs a parser, a matching algorithm, and a stable output shape. Existing options include difftastic, diffsitter, GumTree, and sem-jiff-style operation models.

**Decision.** Parse TypeScript and JavaScript with `@babel/parser`. Implement a focused matcher in core. Do not wrap an external diff CLI in Phase 3. Tree-sitter is deferred until a language outside the Babel family needs structural diff.

**Why not wrap a CLI.** A wrapper means parsing another tool's output into typed operations, which is the hardest part of the integration and the least stable part of the dependency. It also adds a second parser with different language coverage, and a second process per file. The matching ideas from GumTree and difftastic are reused, not their binaries. Babel is already the parser used by the surface detectors, so one parser covers both features.

**Consequences.** Reins owns matcher accuracy. The scope is deliberately small: nine operation kinds over a bounded AST comparison. If precision misses the gate, fall back to move and rename only, and revisit a wrapper with evidence.

**Alternatives considered.**

- difftastic: excellent line pairing, no stable typed operation API, human-oriented output.
- diffsitter: useful artifact diff, not a library, output parsing required.
- sem-jiff: the operation vocabulary informed this design, but the implementation is not adopted.
- A pure line diff with heuristics: cannot detect moves or reformats reliably, which is the product's point.

**Revisit when.** The evaluation shows a precision ceiling that a maintained library beats, or parser packaging becomes a distribution burden.

### ADR-007 Tree-sitter deferred for non-JS languages

**Status:** accepted for the MVP.

**Context.** The MVP needs structural diff for TypeScript and JavaScript. Babel covers those with one dependency and no native build. Tree-sitter would add grammar packaging, a second parser, and a license check before the first user sees a diff.

**Decision.** Ship the Babel matcher. Add Tree-sitter only when a language outside the Babel family needs structural diff, and then behind the same `ParserPort` shape described in `02`.

**Consequences.** Python, Go, Rust, and Vue degrade to a line diff with an explicit flag. The diff contract already carries `degraded` and `degradedReason`, so adding a parser later does not change the API.

**Revisit when.** A user needs structural diff for a non-JS language, or Babel parsing misses the latency budget.

### ADR-008 React Flow and dagre for the graph

**Status:** accepted.

**Context.** Graphs range from 10 to 2,000 visible nodes. The component must embed in a host, not only in the desktop app.

**Decision.** `@xyflow/react` for the canvas, `dagre` for deterministic hierarchical layout. A list view is a first-class alternative, not a fallback for accessibility alone. Sigma.js is deferred until a real graph exceeds what React Flow can render smoothly.

**Consequences.** Small dependency surface, good custom node story, predictable layout. Large graphs need aggregation or a different renderer in Phase 6. Layout runs once per slice and is memoized.

**Rejected.** A custom canvas renderer in Phase 1. A force layout as the default. tldraw as the graph renderer.

### ADR-009 CodeMirror 6 for code display

**Status:** accepted.

**Context.** The diff view needs read-only code with line highlighting and large-file performance. Editing code is out of scope.

**Decision.** CodeMirror 6 with a small set of extensions, loaded only on the diff route.

**Consequences.** Smaller bundle than Monaco, good keyboard behavior, easy decorations for semantic spans. If a future phase adds in-app editing, CodeMirror remains adequate.

### ADR-010 Markdown notes with explicit links, no layer system

**Status:** accepted.

**Context.** The reference knowledge tool used layers declared in `index.md`, frontmatter, wikilinks, and a waterfall. That model is expressive and adds concepts a new repository must learn before writing one note.

**Decision.** Notes are markdown with typed frontmatter. Type is one of five values. Links are explicit and typed in frontmatter. Body `[[id]]` mentions are allowed but only create untyped backlinks. No layers, no ordering file, no waterfall requirement.

**Consequences.** A note is self-describing and a folder is just organization. The board groups by type and tags instead of layers. Migration from a layer-based system is a one-way import helper in Phase 6.

**Rejected.** Making wikilinks the source of truth for typed relations. String parsing cannot reliably distinguish a note, a symbol, and a surface with the same text.

### ADR-011 No tldraw dependency in core or UI

**Status:** accepted.

**Context.** A whiteboard is a strong host for spatial knowledge cards. tldraw is the obvious canvas, but its SDK license is not a permissive open-source license, and its release cadence would become a constraint on the whole UI.

**Decision.** Build the knowledge board on React Flow and plain DOM. Keep every component mountable inside a tldraw host. Ship an example shape in Phase 5, as a separate example package with its own dependency on tldraw.

**Consequences.** Reins stays MIT/Apache-compatible. Hosts that already own a tldraw license can embed. The built-in board is simpler than a full whiteboard, which matches the product.

**Revisit when.** A permissive canvas library with the needed interaction model ships, or the product explicitly buys into tldraw's license.

### ADR-012 No global state library and no search library

**Status:** accepted.

**Context.** The renderer needs a repository session, a selection, and view state. Notes need a ranked search over 1,000 items. Both tempt a dependency.

**Decision.** One `useSyncExternalStore` store for the app, feature-local state otherwise. Knowledge search is a deterministic linear scan with a documented ranking. Symbol search delegates to Trail.

**Consequences.** Less code to learn, no provider trees, no cache invalidation library. A linear scan is fast enough at the stated scale; if 50,000 notes appear, add an index with a benchmark, not a framework.

### ADR-013 Git through the CLI

**Status:** accepted.

**Context.** Diff ranges, blob reads, and commit metadata need Git. A library such as isomorphic-git avoids the binary but reimplements behavior and is slower for large objects.

**Decision.** Spawn `git` with a fixed read-only command allowlist and argument arrays. No shell. No writes.

**Consequences.** Git must be installed, which any developer machine already has. Behavior matches the user's Git version and configuration. Path and encoding edge cases are Git's problem. A missing Git binary is a typed error, not a crash.

### ADR-014 MCP over stdio only

**Status:** accepted.

**Context.** Agents need the same answers as the UI. A network server would add ports, auth, and a new attack surface.

**Decision.** Serve MCP over stdio from `reins mcp`. One repository per process. No listening socket, no token, no remote transport.

**Consequences.** The client spawns the server and controls its lifetime. Hosts that need remote access run their own bridge. Tool output is capped and repository-relative by default.

### ADR-015 LLM features are separate, opt-in, and never required

**Status:** accepted.

**Context.** Summaries and drafted notes are useful. They also break the local-only promise if added carelessly.

**Decision.** No LLM code path before Phase 6. When added, it is a single module, disabled by default, with a keychain-stored key, a preview of what is sent, and explicit labeling of generated text. No indexing, graph, diff, or check feature depends on it.

**Consequences.** The product works fully offline. The optional layer cannot silently change structural answers. Users who want local models can point the module at a local endpoint.

### ADR-016 Code budget and dependency allowlist per phase

**Status:** accepted.

**Context.** "Less code" fails without a number. Small codebases drift through helpful additions.

**Decision.** A production LOC cap and a runtime dependency cap are phase gates, checked by scripts. Adding a dependency requires a catalog entry and a line in the allowlist table. Removing a feature to stay under budget is allowed and preferred over compressing code.

**Consequences.** Scope conversations have a concrete cost. The budget excludes tests and generated code so quality work is never punished.

### ADR-017 Modularity over a plugin system

**Status:** accepted.

**Context.** Surfaces and constraint rules need extension. A plugin API would let third parties add frameworks, but it also freezes internal types early.

**Decision.** Four extension points with explicit registries and no runtime loading: surface detector, note type, constraint rule, parser provider. A new extension is a code change with a fixture.

**Consequences.** No versioned plugin contract in v1. Extensible enough for the frameworks on the roadmap, without designing a public API before the second consumer exists.

### ADR-018 Mantine and an Apple-style shell

**Status:** accepted.

**Context.** The first shell used hand-written CSS and a top bar. It worked, but the visual language was generic and the top bar competed with the command palette for navigation.

**Decision.** Use Mantine for components, theme, and layout primitives. Apply an Apple-style visual language: system font stack, hairline borders, 12 to 16 px radii, translucent dock, blue accent, generous whitespace. Remove the top bar. `Cmd+K` opens a Mantine Spotlight palette, which is the only navigation. `MantineProvider` lives inside `ReinsProvider` so embedded hosts get the same theme.

**Consequences.** The UI gains a consistent component layer and a smaller custom CSS surface. Mantine adds about 300 KB of CSS and 100 KB of JavaScript to the renderer. The palette is the only way to switch tools, so discoverability depends on the dock hint and the `Cmd+K` shortcut. The embeddable components now require Mantine CSS, which `@reins/ui/styles.css` imports.

**Rejected.** Keeping the top bar and adding Mantine only to panels. That leaves two navigation systems. Writing a custom design system instead of Mantine. That is more code for the same result.

## 2. Rejected ideas

| Idea | Why rejected |
| --- | --- |
| Fork Trail to add a stable JSON or surfaces | Duplicates parser and storage maintenance, splits the ecosystem, and makes upgrades a merge. |
| Compile the graph into SQLite for the app | Creates a second source of truth and a second schema to migrate. The reference implementation proves it is feasible, not that it is free. |
| Tauri with Rust adapters | Duplicates Trail, Git, and the diff engine in a second language. |
| A local HTTP server inside the desktop app | Adds a port, a network surface, and auth questions to a local app. |
| Tldraw as the core canvas | License and release coupling. Embedding is supported; dependency is not. |
| Layer-based knowledge waterfall | Adds a required concept and an ordering file before the first note. Type plus links covers the need. |
| PKM-style graph of every note | The graph is useful at 30 to 300 notes, not at 3,000. The review workflow needs decisions and constraints, not a second brain. |
| LLM summarization during indexing | Slow, non-deterministic, and turns a local tool into a paid dependency. |
| Multiplayer or team sync in v1 | Pulls in accounts, permissions, conflict resolution, and a backend. |
| Monaco instead of CodeMirror | Larger bundle, heavier worker setup, and editing is out of scope. |
| A custom element first | React is the primary target. The custom element wrapper is a Phase 5 convenience. |
| Fuzzy search library for symbols | Trail already ranks. A second ranker would disagree with the graph tool. |
| A general constraint expression language | Two focused rules cover the real cases. Expressions need a parser, tests, and a security review. |

## 3. Open questions

| ID | Question | Owner | Decide by | How |
| --- | --- | --- | --- | --- |
| Q-1 | Does Trail's JSON remain stable within 0.28 to 0.30, and what exactly does `build --check` mean for `pending` nodes? | Reins lead | Phase 1, week 1 | Record both versions, run the adapter contract tests, document the drift semantics in `03`. |
| Q-2 | Which parser covers Python, Go, Rust, and Vue when structural diff expands? | Reins lead | Phase 6 | Spike S2: compare Tree-sitter WASM and native bindings, check licenses and file sizes. |
| Q-3 | What precision and recall does the matcher reach on 30 labeled refactors? | Reins lead | Phase 3, mid | Spike S3; publish the confusion matrix. |
| Q-4 | Does tldraw's current SDK allow the example shape under its license without a commercial agreement? | Reins lead | Phase 5 kickoff | Read the current license, build the example only if the terms allow. |
| Q-5 | Does `trail callers` resolve symbols well enough in a monorepo with duplicate package names? | Reins lead | Phase 2 | Run against the monorepo fixture and a real monorepo. If not, add a `--in` path filter to the default flow. |
| Q-6 | Is a custom element build of the graph view practical, or does React Flow need a React root? | Reins lead | Phase 5 | Spike S4. |
| Q-7 | Which Tauri and Rust versions are pinned, and what is the upgrade cadence? | Reins lead | Phase 1 start | Pin the current stable, upgrade once per two phases with a smoke run. |
| Q-8 | How should a note ID be renamed without breaking links? | Reins lead | Phase 4 | Start with a check warning plus a `reins note rename` command that rewrites links atomically. |
| Q-9 | What is the fallback when Trail is absent on Windows? | Reins lead | Phase 6 | Document install paths, detect common locations, and keep the typed error. |

## 4. Assumptions to validate

These are believed but not proven. Each has a test attached.

| Assumption | Test | Phase |
| --- | --- | --- |
| Trail's JSON shape is stable enough to wrap. | Fixtures for 0.28 and 0.30; adapter tests pass on both. | 1 |
| A 5,000-line production codebase is enough for the Phase 1 slice. | LOC budget passes without deleting required error handling. | 1 |
| React Flow with dagre handles 500 visible nodes smoothly. | Recorded interaction at 500 nodes, 60 fps target on the benchmark machine. | 1 |
| The Trail CLI is fast enough for an interactive search. | p95 measured on the large fixture. | 1 |
| Five detectors cover the majority of the target stacks. | Fixture survey plus one real repository per stack. | 2 |
| Babel parses a 5,000-line file fast enough. | Bench in the utility process, p95 under 1 s including match. | 3 |
| The matcher reaches 80% precision on moves and renames. | Labeled evaluation set. | 3 |
| Notes stay under 300 in a typical repository. | Survey of reference repositories; board performance at 300. | 4 |
| A three-pane workspace is usable at 1,280 px. | Recorded usability pass, plus a 960 px layout. | 5 |
| Hosts can supply a client without leaking Tauri types. | Example app builds with no Tauri import. | 5 |

## 5. Spikes

A spike is timeboxed, throws its code away unless promoted, and ends with a written result.

| ID | Spike | Timebox | Deliverable | Decision it informs |
| --- | --- | --- | --- | --- |
| S1 | Trail contract conformance across two versions | 2 days | Recorded JSON, drift notes, adapter test matrix | Q-1, ADR-002 confidence |
| S2 | Grammar packaging and license | 2 days | Parsed TS, TSX, JS samples, licenses, sizes, load times | Q-2, ADR-007 |
| S3 | Matcher on 30 labeled refactors | 4 days | Confusion matrix, failure examples, precision per op | Q-3, Phase 3 scope |
| S4 | Graph view inside a host and a custom element | 3 days | Working host example, bundle size, limitations | Q-6, Phase 5 scope |
| S5 | Memory and render at 2,000 nodes | 2 days | RSS, frame times, aggregation prototype | GRAPH-6 scope |
| S6 | 1M LOC graph and query | 2 days | Build time, status time, query p95 | Phase 6 gate |

Spike rules:

- Code lives under `spikes/<id>/`, is not published, and is deleted or promoted at the end.
- The result is a short markdown note plus raw measurements, linked from this file.
- A spike does not change the architecture by itself. It produces evidence for a decision record.

## 6. Risk register

| ID | Risk | Likelihood | Impact | Mitigation | Early signal |
| --- | --- | --- | --- | --- | --- |
| R-1 | Trail JSON changes or is removed | Medium | High | Version range, fixtures, schema validation, upstream conversation | Adapter fixture fails on a Trail upgrade |
| R-2 | Matcher precision is too low | High | High | Small op set, labeled eval, confidence labels, cut extraction | False move rate above 5% in evaluation |
| R-3 | Non-JS parser coverage blocks structural diff | Medium | Medium | Babel covers JS/TS now; Tree-sitter is deferred behind `ParserPort`; degraded line diff is explicit | A user needs structural diff for Python, Go, or Rust |
| R-4 | Tauri or sidecar memory exceeds the budget | Medium | Medium | Lazy chunks, node caps, list view, one sidecar per repo | RSS above 350 MB with one repository open |
| R-5 | Surface detection creates false links | High | Medium | Fixture golden tests, confidence labels, diagnostics | A fixture route links to an unrelated handler |
| R-6 | Scope creep into an IDE | Medium | High | Non-goals list, phase gates, ADR-016 budget | A request to add editing, terminals, or LSP features |
| R-7 | Knowledge tooling becomes a second product | Medium | High | Five note types, two rules, no plugin system | A proposal for custom note schemas or an expression language |
| R-8 | Code budget harms readability | Low | Medium | Budget excludes tests, delete features instead of compressing | Reviewers cannot follow a 4,000-line module |
| R-9 | pnpm or Node toolchain mismatch | Medium | Low | Pinned engines and `packageManager`, CI parity | Install fails on a fresh machine |
| R-10 | Trail or Git child processes hang | Low | Medium | Timeouts, abort, kill tree, typed errors | A request never settles |
| R-11 | Path traversal in a malicious repository | Low | High | Realpath containment, tests for symlinks and `..`, no shell | Any path accepted outside the root |
| R-12 | Prompt injection through code or notes | Medium | High | Untrusted content labels, no instruction following, no writes outside inbox | A note asks the agent to run a command or change a rule |
| R-13 | Three-pane state becomes unmanageable | Medium | Medium | One selection object, reducer, tests, cut the knowledge pane | Selection bugs between panes |
| R-14 | Performance regresses silently | Medium | Medium | Bench job, recorded baselines, 20% gate | p95 drift in two consecutive runs |
| R-15 | Trail license or availability changes | Low | High | Track license, keep adapter replaceable, document the dependency | Repository license change or archive notice |

## 7. Licensing check

Before shipping, verify each dependency's license and record it in `NOTICE` if required.

| Component | Expected license | Status |
| --- | --- | --- |
| Trail | Verify at phase start | Not yet verified |
| Tauri, `@tauri-apps/*` | MIT or Apache-2.0 | Verify at install |
| React, React DOM | MIT | Verify at install |
| `@xyflow/react` | MIT | Verify at install |
| dagre | MIT | Verify at install |
| CodeMirror 6 packages | MIT | Verify at install |
| `@babel/parser` | MIT | Verify at install |
| zod | MIT | Verify at install |
| commander | MIT | Verify at install |
| MCP SDK | MIT | Verify at install |
| tldraw (example only) | Source-available, not OSI open source | Do not ship until Q-4 is resolved |

The product stays MIT or Apache-2.0 compatible. No dependency with a copyleft or commercial restriction enters a runtime package. Example-only dependencies are isolated in `examples/` and excluded from published packages.

## 8. Decision process

- A decision that changes a public contract, a package boundary, a dependency, or a phase gate needs a record here before implementation.
- Records are append-only. Superseding means a new record that names the old one.
- A disagreement that cannot be resolved in one conversation goes to a spike with a timebox, not to a longer meeting.
- When a phase gate fails, the record states which option was taken: fix, cut, or pivot. There is no "continue and see".
