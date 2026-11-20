# 02. Architecture

This is the engineering contract for Reins. It defines the process model, package boundaries, ports, the single API, storage, caching, security, and budgets. Data shapes live in [03. Data contracts](03-data-contracts.md); phase scope lives in [04. Roadmap](04-roadmap.md).

## 1. System context

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Hosts                                                                │
│  ┌────────────────┐  ┌──────────────┐  ┌────────────┐  ┌───────────┐ │
│  │ Tauri shell    │  │ Terminal     │  │ MCP client │  │ React app │ │
│  │ (Rust+webview) │  │ `reins` CLI  │  │ (agent)    │  │ (embed)   │ │
│  └───────┬────────┘  └──────┬───────┘  └─────┬──────┘  └─────┬─────┘ │
└──────────┼──────────────────┼────────────────┼───────────────┼───────┘
           │ invoke           │ direct         │ stdio         │ client
           ▼                  ▼                ▼               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ @reins/node  ·  Node sidecar  ·  RepoSession  ·  ReinsApi             │
│  ports: TrailPort, GitPort, FsPort, ProcessPort, WatchPort            │
└───────────────┬──────────────────────────────────────────────────────┘
                │ pure calls
┌───────────────▼──────────────────────────────────────────────────────┐
│ @reins/core                                                          │
│  config · errors · api types · surfaces · diff matcher · knowledge    │
│  link graph · check rules · harness pack composer                    │
│  ports: ParserPort, ClockPort                                       │
└───────────────┬──────────────────────────────────────────────────────┘
                │ reads only
┌───────────────▼──────────────────────────────────────────────────────┐
│ Repository                                                           │
│  graft/  (Trail graph)   .trail/ (Trail learnings)                    │
│  .reins/config.json  .reins/knowledge/**/*.md  .reins/.cache/         │
└──────────────────────────────────────────────────────────────────────┘
```

Two rules make this diagram hold:

1. The core is pure. It receives text, parsed structures, and paths as data and returns results. It never imports `node:*`, Tauri, React, or a database driver.
2. The API is defined once in core. CLI, Tauri, and MCP are thin adapters over the same method set. A feature that exists in one transport and not the others is a defect, not a roadmap item.

## 2. Runtime and process model

### 2.1 Desktop

```text
┌──────────────────── Tauri app ────────────────────────┐
│ Rust shell (Tauri)                                    │
│   window, native dialog, sidecar lifecycle            │
│   commands: open_repository, reins_invoke,            │
│             close_repository, reveal_in_editor        │
│                                                       │
│ Node sidecar (apps/cli/dist/serve.js)                 │
│   RepoSession, Trail, Git, AST parser, diff matcher   │
│   newline-delimited JSON over stdin/stdout            │
│                                                       │
│ renderer (system webview)                             │
│   React 19, @reins/ui, Tauri invoke client            │
└───────────────────────────────────────────────────────┘
```

Rules:

- Rust owns the window, the native folder dialog, and the sidecar process. It contains no graph, diff, or knowledge logic.
- The renderer cannot pick arbitrary paths. It calls the dialog plugin, then `open_repository` with the selected path.
- The sidecar owns the only `RepoSession`. Closing a repository sends `close`, then kills the process. Tauri resolves `apps/cli/dist/serve.js` from `CARGO_MANIFEST_DIR`; `REINS_SERVE_SCRIPT` overrides it.
- Long work runs in the sidecar. Tauri commands await one JSON response and never block the webview.
- One window in Phase 1. Multiple windows are not planned before Phase 6, and each would own its own sidecar.

### 2.2 CLI

`reins` is an ESM Node 22 binary. It imports `@reins/node`, builds a `RepoSession` for the current directory or `--repo`, calls one API method, prints text or JSON, and exits. The CLI owns no logic beyond argument parsing, progress rendering, and exit codes.

`reins mcp` starts the same session and serves MCP over stdio. It writes protocol messages to stdout, so all diagnostics go to stderr.

### 2.3 Embedded components

A host renders `<ReinsProvider client={client}>` and mounts views. `ReinsProvider` includes `MantineProvider` with the Reins theme, so the host does not need its own provider. The host supplies a `ReinsClient`: the Tauri invoke client in the desktop app, a memory client in tests and docs, or its own transport. Nothing in `@reins/ui` assumes Tauri, a repository path, or a Node process.

The desktop renderer uses the same provider and components. The only difference is the client implementation over Tauri invoke.

## 3. Packages and dependency rule

```text
apps/desktop        private, Tauri Rust shell + Node sidecar + renderer
apps/cli            published binary `reins` (includes `reins mcp`)
packages/core       pure domain, published
packages/node       Node adapters and RepoSession, published
packages/ui         React components, published
```

```text
core  <-  node  <-  { apps/cli, apps/desktop sidecar }
core  <-  ui    <-  { apps/desktop renderer, host apps }
node  <-/-> ui        forbidden
```

| Package | Owns | Must not |
| --- | --- | --- |
| `@reins/core` | Types, validation, graph result shaping, surface types and IDs, diff types and operation helpers, knowledge schema and link rules, harness pack composer | Read files, spawn processes, import Node or Tauri, render React |
| `@reins/node` | Trail and Git adapters, AST parser and diff matcher, surface detectors, knowledge loader, path safety, cache files, `RepoSession`, `ReinsApi` implementation, MCP server bootstrap | Contain UI, duplicate domain rules from core |
| `@reins/ui` | React components, Mantine theme and tokens, keyboard behavior, view state, client interface consumption | Touch the filesystem, spawn processes, import `@reins/node` |
| `apps/cli` | Argument parsing, exit codes, text rendering, MCP stdio wiring | Query logic, diff logic, knowledge parsing |
| `apps/desktop` | Tauri window, native dialog, sidecar lifecycle, renderer layout | Query logic, second graph store |

Boundary enforcement is a test, not a convention. `scripts/check-boundaries.ts` scans source imports and fails on a forbidden edge. It is part of `pnpm check`.

Why these five and not more:

- No `@reins/schema` package. Types live in `core`; there is no second consumer that justifies a package.
- No `@reins/mcp` package. MCP is a subcommand of the CLI.
- No `@reins/desktop-kit`. Tauri-specific code has one consumer.
- No `@reins/protocol` package. The API types live in core and are imported by every transport.

## 4. Ports

Adapters are narrow interfaces. The shapes below are the boundary contract; the MVP implements them as classes in `@reins/node`. They exist so core stays testable and Trail can be replaced without touching domain logic.

```ts
// core
interface ParserPort {
  parse(language: Language, text: string): ParsedTree;   // @babel/parser today
  dispose(): void;
}

// node
interface TrailPort {
  version(): Promise<string>;
  status(root: string): Promise<TrailStatus>;
  build(root: string, onProgress: (line: string) => void): Promise<void>;
  callers(req: TrailCallersRequest): Promise<TrailCallersResult>;
  ask(req: TrailAskRequest): Promise<TrailAskResult>;
  skeleton(file: string): Promise<TrailSkeletonResult>;
}

interface GitPort {
  head(root: string): Promise<string>;
  isDirty(root: string): Promise<boolean>;
  changedFiles(root: string, range: DiffRange): Promise<FileChange[]>;
  readAt(root: string, rev: string, path: string): Promise<string>;
  log(root: string, path: string, limit: number): Promise<CommitInfo[]>;
}

interface FsPort {
  readText(root: string, path: string): Promise<string>;
  writeAtomic(root: string, path: string, text: string): Promise<void>;
  list(root: string, glob: string): Promise<string[]>;
  stat(root: string, path: string): Promise<FileStat>;
  realpath(root: string, path: string): Promise<string>;
}

interface WatchPort {
  watch(root: string, onChange: (paths: string[]) => void): Disposable;
}
```

`watchRepo` in `@reins/node` implements this port with a recursive `fs.watch`, a 120 ms debounce, and an ignore list for build output, caches, and `.git` internals other than `index`, `HEAD`, and `refs/`.

Port rules:

- Every method takes repository-relative paths. Containment is checked inside the implementation, not by callers.
- Every method has a timeout or an abort signal. Defaults: 10 s for queries, 120 s for build, 30 s for Git.
- Errors are thrown as `ReinsError` with a code from `03`. Ports do not throw raw process errors.
- No port returns a stream except `build`, which reports progress lines through a callback.

## 5. One API, three transports

The canonical interface, defined in `@reins/core`:

```ts
interface ReinsApi {
  status(): Promise<RepoStatus>;
  refreshGraph(opts?: RefreshOptions): Promise<RepoStatus>;
  searchSymbols(q: string, opts?: SearchOptions): Promise<SymbolHit[]>;
  listSymbols(req?: SymbolListRequest): Promise<SymbolHit[]>;
  graph(req: GraphRequest): Promise<GraphSlice>;
  listSurfaces(f?: SurfaceFilter): Promise<SurfacePage>;
  flow(req: FlowRequest): Promise<GraphSlice>;
  diff(req: DiffRequest): Promise<SemanticDiff>;
  listNotes(f?: NoteFilter): Promise<NoteSummary[]>;
  getNote(id: string): Promise<KnowledgeNote>;
  proposeNote(input: NoteProposal): Promise<NoteProposalResult>;
  check(req?: CheckRequest): Promise<CheckReport>;
  harnessPack(req: PackRequest): Promise<HarnessPack>;
}
```

Transport mapping:

| Core method | CLI | Tauri invoke | MCP tool |
| --- | --- | --- | --- |
| `status` | `reins status` | `status` | `reins_status` |
| `refreshGraph` | `reins build` | `refreshGraph` | not exposed |
| `searchSymbols` | `reins search <q>` | `searchSymbols` | `reins_symbols` |
| `listSymbols` | `reins symbols` | `listSymbols` | `reins_symbols_list` |
| `graph` | `reins callers`, `reins callees`, `reins graph` | `graph` | `reins_callers` |
| `listSurfaces` | `reins surfaces` | `listSurfaces` | `reins_surfaces` |
| `flow` | `reins flow <target>` | `flow` | `reins_flow` |
| `diff` | `reins diff <range>` | `diff` | `reins_diff` |
| `listNotes` | `reins notes` | `listNotes` | `reins_knowledge_search` |
| `getNote` | `reins note <id>` | `getNote` | `reins_knowledge_get` |
| `proposeNote` | `reins note propose` | not exposed | `reins_knowledge_propose` |
| `check` | `reins check` | `check` | `reins_check` |
| `harnessPack` | `reins pack` | not exposed | `reins_harness_pack` |

Every transport performs the same three steps: validate input with the core zod schema, call the method, serialize the result or the error. Build and diff progress is delivered as advisory events on a separate channel, never as part of a method result.

Adding a method means adding it to core, then all three transports, then one contract test per transport. No transport-specific options that change semantics.

## 6. Storage

```text
<repo>/
├── graft/                         Trail graph. Owned by Trail. Never written by Reins.
├── .trail/                        Trail learnings. Read by `reins check --learnings` later.
├── openspec/                      OpenSpec knowledge. Read-only. Never written by Reins.
└── .reins/                        Committed unless marked cache.
    ├── config.json                Repository config and detector options.
    ├── knowledge/
    │   ├── specs/
    │   ├── decisions/
    │   ├── constraints/
    │   ├── howto/
    │   ├── questions/
    │   └── inbox/                 Proposed notes awaiting human review.
    ├── .cache/                    Gitignored, derived, deletable.
    │   ├── surfaces.json
    │   ├── knowledge-index.json
    │   ├── diff/<key>.json
    │   ├── session.json           Recent repos, window bounds, local UI state.
    │   └── logs/
    └── .gitignore                 Ignores .cache/ and nothing else.
```

Rules:

- The knowledge markdown is the source of truth. Every index under `.cache` is rebuildable in one pass and has no data that exists only there.
- `openspec/` is read-only. Reins imports it as knowledge and never writes to it.
- No second graph store. Reins never copies `graft/` into SQLite, JSON, or memory-mapped files of its own. Graph slices are computed per request and cached only in memory for the process lifetime.
- A deleted `.cache` must produce a correct app with a slower first query. This is tested.
- Config is JSON. Knowledge frontmatter is YAML. Do not add a second YAML config surface.
- Knowledge folders are organizational. The note's `type` field is authoritative, and `reins check` reports a folder and type mismatch as a warning.

## 7. Caching and invalidation

| Cache | Key | Stored | Invalidate when |
| --- | --- | --- | --- |
| Process graph reads | method + args + graph fingerprint | memory | fingerprint changes |
| Surfaces | fingerprint + detector versions + file mtimes | `.cache/surfaces.json` | any input file mtime changes or fingerprint changes |
| Knowledge index | hash of all note text + config | `.cache/knowledge-index.json` | any note text changes |
| Diff | old blob hash + new blob hash + parser version + matcher version | `.cache/diff/<key>.json` | one of the key parts changes |
| Symbol verification | file path + file mtime + graph fingerprint | memory | file or graph changes |

The graph fingerprint is:

```text
sha256(
  trail version,
  status.codeMap.nodes,
  status.codeMap.inSync,
  git HEAD,
  git dirty flag,
  adapter version,
  contract version
)
```

On a cache mismatch, the consumer recomputes and replaces the file atomically. A corrupt cache file is deleted and rebuilt, never repaired in place.

Cache files include a `schemaVersion`. A version mismatch discards the file. Cache files never include absolute paths; the repository root is injected at runtime.

## 8. Flows

### 8.1 Open repository

```text
user picks folder
  -> main normalizes and realpaths the path, rejects escapes
  -> read .reins/config.json (optional)
  -> detect trail: version, graft presence
  -> trail status --json
  -> compose RepoStatus
  -> renderer shows status, recent query, or empty state
```

No scan runs on open. Surfaces and knowledge index load lazily when their view opens, or on `refreshGraph`. The status call must not take over 1.5 s warm; if Trail is slow, the UI shows `checking` and updates when done.

### 8.2 Symbol query to graph

```text
renderer: graph({ root, direction, depth })
  -> Tauri validate
  -> RepoSession checks fingerprint once
  -> TrailPort.callers(--json --direction --depth --no-refresh)
  -> normalize spans "L2-L4" to startLine/endLine
  -> cap nodes, dedupe, sort
  -> return GraphSlice with revision and truncated flag
  -> renderer lays out with dagre, renders React Flow
```

`--no-refresh` is used after one `status` check so a single request sees one graph revision. Without it, Trail may refresh mid-request and produce mixed results.

### 8.3 Semantic diff

```text
resolve range -> changed files (Git)
  -> for each file: read old rev, working tree, or index blob
  -> content hash both sides, check cache
  -> send contents + language to utility process
  -> @babel/parser parse both sides (JS/TS)
  -> core matcher produces operations
  -> merge with file change status (added, deleted, renamed, mode change)
  -> return SemanticDiff; UI renders operations and code
```

Parsing never runs in the renderer. If the utility process dies, the request returns `DIFF_WORKER_FAILED` and the UI offers a line diff fallback.

### 8.4 Knowledge and check

```text
load knowledge folder
  -> parse frontmatter with yaml, validate with zod
  -> extract [[links]] from body
  -> build in-memory note graph and symbol/surface edges
  -> check: broken links, duplicate IDs, unknown types, folder mismatch
  -> check with --code: verify symbol IDs through trail skeleton per file (cached)
  -> report items with severity, note id, path, and fix hint
```

`check --code` batches verification by file. It does not call Trail once per symbol. Files not present in the graph are reported as `unknown-file`, not as a crash.

### 8.5 Agent request

```text
MCP client calls reins_flow with a route
  -> same RepoSession and API
  -> result capped by maxNodes and maxTokens
  -> response includes repo id, graph revision, and truncation
```

No separate agent database, no precomputed agent index. The agent path and the human path must agree, which is why there is one API.

## 9. Concurrency, cancellation, and limits

- One in-flight `refreshGraph` per repository. A second request joins the first or fails with `BUILD_IN_PROGRESS`.
- Graph and search requests are concurrent up to 4. Beyond that they queue. Trail processes are independent, so this is a policy cap, not a correctness requirement.
- Every request accepts an `AbortSignal` from the transport. On abort, child processes are killed with SIGTERM, then SIGKILL after 2 s.
- Node and token caps are applied after normalization and before serialization: graph 500 nodes by default (2,000 hard), MCP 300 nodes, diff 500 operations per file, surfaces 1,000 per page.
- Truncation is explicit. A result that hit a cap sets `truncated: true` and `truncatedBy: 'nodes' | 'tokens' | 'time'`.
- Timeouts produce a typed error with the operation name and elapsed time. No silent empty results.

## 10. Security and trust boundaries

Reins indexes repositories it did not write. Treat repository content as untrusted input.

- **Parser only.** Reins never runs project scripts, package managers, tests, hooks, or build tools. Trail and Git are the only child processes.
- **Command execution.** `spawn` with an argument array, `shell: false`. The sidecar spawns only `trail` and `git`; Rust spawns only the Node sidecar. Environment is inherited but `GIT_TERMINAL_PROMPT=0` and `GIT_OPTIONAL_LOCKS=0` are set. No user string is interpolated into a shell command.
- **Path containment.** Normalize, resolve symlinks, then require the result to stay under the repository root. Refuse `..` and absolute paths in repository-relative fields. Re-check on the receiving side of every Tauri command.
- **Git.** Read-only commands only: `rev-parse`, `status`, `diff`, `show`, `log`, `ls-tree`. No checkout, reset, clean, or stash.
- **Trail.** Run with the repository as cwd. Do not pass `--deep` unless the user explicitly enables the LLM pass.
- **Rendering.** Code snippets and note bodies render as text. Markdown is sanitized; raw HTML is disabled by default. No `dangerouslySetInnerHTML` outside the sanitizer.
- **Tauri.** The renderer runs in the system webview with a strict CSP. Rust exposes four commands. The Node sidecar is spawned by Rust with a fixed script path and no shell.
- **MCP.** stdio only, no listening socket. Results are repository-relative by default. The only write tool is `reins_knowledge_propose`, which writes to `knowledge/inbox/` and refuses paths outside it.
- **LLM.** Disabled by default. Enabling requires an explicit provider and model choice. Keys live in the OS keychain, never in `.reins/config.json`. Every call shows what will be sent and logs the byte count. No automatic background enrichment.
- **Secrets.** Never index `.env`, keys, or files matched by the config's `secretPatterns`. The default list includes `.env*`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`.

Threat model in one line: a malicious repository can waste CPU and produce misleading text; it cannot execute code, read outside its root, or make Reins write outside the knowledge inbox.

## 11. Performance budgets

| Operation | Target | Conditions |
| --- | --- | --- |
| Desktop warm start to status | ≤ 1.5 s | 100k LOC, graph built, SSD |
| `status` | ≤ 400 ms p95 | Trail status plus version check, cached for 5 s |
| Symbol search | ≤ 150 ms p95 | 500k node graph, Trail ask limit 20 |
| Depth 2 graph | ≤ 250 ms p95 | 200k node graph, 500 node cap |
| Depth 5 graph | ≤ 1.2 s p95 | Same, 2,000 node hard cap |
| Surfaces scan | ≤ 3 s | 5,000 files, 40 detector candidates, warm parser |
| Diff, 1,000 lines | ≤ 300 ms p95 | One file, one pair |
| Diff, 5,000 lines | ≤ 1 s p95 | One file, degrade above 20k nodes |
| Knowledge index | ≤ 300 ms | 1,000 notes |
| `check` | ≤ 1 s | 1,000 notes, no code verification; ≤ 4 s with code verification |
| Idle memory | ≤ 350 MB RSS | Desktop, one repo, no diff open |
| Renderer bundle | ≤ 1.5 MB gzip initial | Graph and CodeMirror split into separate chunks |

Measurement method:

- A fixed fixture corpus plus one real repository snapshot, both pinned by commit.
- A script under `scripts/bench/` records p50 and p95 over 30 runs, the machine model, Node and Tauri versions, and the graph node count.
- CI runs the budget checks that do not need a GUI. GUI timings run manually before a release and are recorded in the phase notes.
- A regression over 20% fails the phase, not just a warning.

## 12. Build, packaging, and release

| Task | Command (planned) | Notes |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` | pnpm 10, catalog versions |
| Dev desktop | `pnpm dev` | Tauri CLI, Vite HMR renderer |
| Dev CLI | `pnpm --filter reins dev -- status` | tsx or built output |
| Build | `pnpm build` | tsup, Vite, Tauri |
| Check | `pnpm check` | format check, lint, typecheck, boundary test, unit tests |
| Test | `pnpm test` | Vitest, integration opt-in |
| Package desktop | `pnpm --filter @reins/desktop build` | Tauri binary; bundle disabled in the MVP |
| Publish | `pnpm release` | npm packages, not the desktop app |

Build rules:

- TypeScript strict, ESM only, `moduleResolution: "bundler"` for UI and `"nodenext"` for Node packages.
- `tsup` builds `core`, `node`, and the CLI. `pnpm -r build` respects topology.
- The UI and desktop renderer use Vite. Mantine CSS is processed by `postcss-preset-mantine`. Tauri builds the Rust shell with Cargo. The sidecar is `apps/cli/dist/serve.js`.
- Versions are pinned in `pnpm-workspace.yaml` under `catalog:` and referenced as `catalog:`. One upgrade point.
- The desktop app is private and never published to npm.
- Builds are reproducible enough for release: lockfile committed, no postinstall scripts beyond the Tauri CLI and esbuild, no network at runtime.

## 13. Extensibility

Four extension points exist in v1. Nothing else is pluggable.

| Point | Interface | Registration | Test requirement |
| --- | --- | --- | --- |
| Surface detector | `SurfaceDetector` | Explicit array in `core/src/surfaces/registry.ts` | Fixture repository and golden surfaces |
| Knowledge type | `NoteTypeSpec` | Explicit record in `core/src/knowledge/types.ts` | Schema fixture and one valid and invalid note |
| Constraint rule | `ConstraintEvaluator` | Explicit record, three rules maximum in Phase 4 | Unit test per rule plus a diff fixture |
| Parser | `ParserPort` provider | Injected at session creation | Parse smoke test per language |

No runtime plugin loading, no dynamic `import()` of repository code, no third-party extension API in v1. A new framework detector is a code change with a test, not a config file.

## 14. Deliberately not built

The following are rejected, not deferred. Reasons are in [07. Decisions and risks](07-decisions-and-risks.md).

- A second graph database or a copy of Trail's graph.
- A language server or full type checker.
- A hosted index or cloud sync.
- A web server for the desktop app.
- A tldraw dependency in core or UI packages.
- A custom diff algorithm based on line matching with heuristics layered on top.
- Write access to source code from the review surface.
- A generic plugin marketplace.
