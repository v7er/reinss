# 05. Phase 1: Foundation

Phase 1 builds the smallest codebase that can carry the rest of the product. It is not a prototype. It has real error handling, real tests, and one complete vertical slice. It also has a hard code budget, because every later phase inherits whatever shape this phase establishes.

Read [02. Architecture](02-architecture.md) first. This document turns it into a build plan.

## 1. Goal

One path, end to end:

```text
open repository
  -> validate and fingerprint
  -> detect Trail and graph state
  -> search a symbol
  -> load callers or callees from Trail
  -> render a graph in the desktop app
  -> open the selected symbol's source line in the editor
```

Plus the same path over CLI JSON and three MCP tools, because the API must be transport-neutral from day one.

## 2. Non-goals

- Surface detection, semantic diff, knowledge nodes, watcher, LLM, packaging for distribution.
- Multiple windows, tabs, or workspaces.
- Settings UI beyond theme and recent repositories.
- Windows and Linux builds.
- Publishing to npm.

If a task does not serve the vertical slice or the quality gates, it waits.

## 3. Exit criteria

The phase is done when all of these are true.

- [ ] Clean clone: `pnpm install --frozen-lockfile && pnpm check` passes.
- [ ] `pnpm --filter @reinss/desktop build` succeeds and the smoke test launches the app.
- [ ] `reins init` creates `.reins/config.json`, `.reins/.gitignore`, and the empty knowledge folders, and refuses to overwrite an existing config.
- [ ] Opening `test/fixtures/graph-basic` reports `state: ready`, `inSync: true`, and the expected node count.
- [ ] Searching `total` returns the symbol with path and line.
- [ ] Callers of `add` show `total`; depth 2 shows `main`; the edge list matches the golden slice.
- [ ] The graph renders and is keyboard navigable; selecting a node opens the editor at the right line.
- [ ] `reins status --json`, `reins callers add --json`, and `reins search total --json` validate against contract fixtures.
- [ ] `reins mcp` answers `reins_status`, `reins_symbols`, and `reins_callers` with bounded output.
- [ ] Boundary test fails on an intentional forbidden import.
- [ ] LOC budget passes at 5,000 or fewer production lines.
- [ ] Dependency budget passes at 12 or fewer runtime dependencies, all on the whitelist.
- [ ] Benchmark note records depth 2 p95 of 250 ms or less on the large fixture.
- [ ] `AGENTS.md` and two project skills are present and accurate.
- [ ] The demo script in section 14 was run and recorded.

## 4. Repository layout

```text
reins/
├── AGENTS.md
├── README.md
├── docs/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
├── vitest.config.ts
├── scripts/
│   ├── check-boundaries.ts
│   ├── check-budget.ts
│   └── bench/graph.ts
├── apps/
│   ├── cli/
│   │   ├── package.json
│   │   └── src/
│   │       ├── main.ts
│   │       ├── commands/{init,status,search,graph,mcp}.ts
│   │       └── render/{text,json,progress}.ts
│   └── desktop/
│       ├── package.json
│       ├── vite.config.ts
│       ├── src-tauri/
│       └── src/
│           ├── src-tauri/src/{main.rs,lib.rs}
│           ├── src-tauri/tauri.conf.json
│           └── renderer/{main.tsx,App.tsx,layout/,hooks/,styles/}
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── api.ts
│   │       ├── config.ts
│   │       ├── errors.ts
│   │       ├── ids.ts
│   │       ├── revision.ts
│   │       └── graph/{normalize.ts,cap.ts,sort.ts,span.ts}
│   ├── node/
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── session.ts
│   │       ├── path.ts
│   │       ├── process.ts
│   │       ├── cache.ts
│   │       ├── trail/{adapter.ts,schema.ts,compat.ts,errors.ts}
│   │       └── git/adapter.ts
│   └── ui/
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── client.ts
│           ├── provider.tsx
│           ├── theme.css
│           ├── components/{GraphView.tsx,GraphNode.tsx,RepoStatus.tsx}
│           └── hooks/{useGraph.ts,useStatus.ts}
└── test/
    ├── fixtures/
    │   ├── graph-basic/
    │   ├── graph-monorepo/
    │   ├── graph-empty/
    │   ├── trail/{0.28.0/*.json}
    │   └── fake-trail.mjs
    ├── contract/
    ├── integration/
    └── smoke/
```

This is a target, not a proof of work. Files may be merged when a file would hold under 30 lines, but packages and the API boundary do not move.

## 5. Toolchain

| Tool | Choice | Reason |
| --- | --- | --- |
| Runtime | Node.js 22 LTS | Tauri sidecar and CLI target the same language level. Node 26 on the development machine is allowed for docs, not the supported runtime. |
| Package manager | pnpm 10, pinned by `packageManager` | Workspace protocol, catalog versions, one lockfile. |
| Language | TypeScript 5.9 or newer, strict | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. |
| Lint and format | Biome 2 | One binary, one config, no ESLint and Prettier pair. |
| Tests | Vitest | Fast, ESM-native, no separate transform. |
| Desktop build | Tauri + Vite | Rust shell, system webview, Vite HMR renderer. |
| Packaging | Tauri bundler | Phase 6. Bundle disabled in the MVP. |
| UI | React 19 and Vite | Same renderer as any host app. |
| Graph view | `@xyflow/react` plus `dagre` | Small, embeddable, deterministic layout. |
| Desktop smoke | Tauri binary smoke (dev only) | Launches the built app and asserts the vertical slice. |

No turbo, no Nx, no ESLint, no Prettier, no commit hooks in Phase 1. `pnpm -r` and a single CI job are enough. Add a task runner only when CI time or cache misses justify it, with a decision record.

Version policy:

- All third-party versions live in `pnpm-workspace.yaml` under `catalog:`.
- Packages reference `catalog:` for third-party and `workspace:*` for internal.
- Tauri and Rust versions are pinned at phase start and upgraded deliberately, with a smoke run.
- Node engines: `>=22.0.0`. pnpm refuses installs outside the range.

## 6. Runtime dependency whitelist

| Package | Where | Why |
| --- | --- | --- |
| `zod` | core | One validation library for config, Trail JSON, API params, and sidecar input. |
| `commander` | cli | Argument parsing. Do not hand-roll subcommands. |
| `@modelcontextprotocol/sdk` | cli | MCP stdio server. |
| `react`, `react-dom` | ui, desktop | UI runtime. Peer dependencies of `@reinss/ui`. |
| `@xyflow/react` | ui | Graph canvas. |
| `dagre` | ui | Deterministic layout for small and medium graphs. |
| `@tauri-apps/api`, `@tauri-apps/plugin-dialog` | desktop | Tauri invoke and native folder dialog. |
| `@tauri-apps/cli` | desktop dev | Tauri dev and build commands. |

Total runtime dependencies: 7. The cap is 12 to leave room for Phase 3 parsers without renegotiating the budget.

Explicitly rejected in Phase 1:

- A state library. One `useSyncExternalStore` store in the renderer is enough.
- A logging library. A 40-line structured logger writing to stderr and a rotating cache log is enough.
- A markdown renderer. Notes arrive in Phase 4.
- A SQLite driver. There is no second graph store.
- `execa`. `node:child_process.spawn` with an argument array is the requirement.

Deferred, not rejected:

- `fast-glob` arrives with the surface scanner in Phase 2 and is added to the catalog then.
- A component test library arrives with the second UI component, if the Tauri smoke test stops being enough.

## 7. Package contracts

### 7.1 `@reinss/core`

Exports only what transports and UI need:

```ts
export interface ReinsApi { /* section 8 */ }
export type { RepoStatus, GraphSlice, GraphRequest, SymbolHit, SearchOptions, RefreshOptions, ApiEnvelope };
export { ReinsError, isReinsError };            // error class plus guard
export { parseConfig, defaultConfig };          // config schema
export { validateApiParams };                   // per-method zod schemas
export { normalizeCallers, capSlice, sortSlice };
export { computeFingerprint };
export { contractVersion };
```

Internal modules may be imported by tests with a relative path but not by other packages. The package `exports` map exposes only `"."`, so deep imports fail at build time.

Rules:

- No `node:*`, no Tauri, no `react`, no `process`, no `__dirname`.
- No I/O. Functions are pure and synchronous unless documented.
- Every public function has one test with a fixture and one edge-case test.
- `any` is forbidden in public types. Use `unknown` at boundaries and parse.

### 7.2 `@reinss/node`

Exports:

```ts
export { createSession, type RepoSession } from './session';
export { createTrailAdapter } from './trail/adapter';
export { createGitAdapter } from './git/adapter';
export { resolveWithinRoot } from './path';
export { runProcess } from './process';
```

`RepoSession` is the only stateful object:

```ts
interface RepoSession {
  readonly root: string;
  status(): Promise<RepoStatus>;
  refreshGraph(opts?: RefreshOptions, onProgress?: (line: string) => void): Promise<RepoStatus>;
  searchSymbols(q: string, opts?: SearchOptions): Promise<SymbolHit[]>;
  graph(req: GraphRequest): Promise<GraphSlice>;
  dispose(): Promise<void>;
}
```

It owns the adapters, the process cache, and the current fingerprint. It does not own UI state, config writing, or window management.

`createSession({ root, env?, now?, trailBinary?, gitBinary? })` accepts injected dependencies for tests. No singleton, no module-level mutable state.

### 7.3 `@reinss/ui`

Exports:

```ts
export { ReinsProvider } from './provider';
export { GraphView } from './components/GraphView';
export { RepoStatus } from './components/RepoStatus';
export type { ReinsClient, NavigationTarget } from './client';
```

Rules:

- `@reinss/ui` declares `react` and `react-dom` as peer dependencies, not bundled.
- The built package ships ESM only plus the token stylesheet. Phase 5 adds the custom element build.
- Components never import `@reinss/node` or `@reinss/core` values beyond types and error guards. If a component needs a rule, it gets it from the client response.
- A component that cannot render without a repository renders an explicit empty state.

## 8. API for Phase 1

Only these methods exist. Adding one is a contract change with tests in all three transports.

```ts
interface ReinsApi {
  status(): Promise<RepoStatus>;
  refreshGraph(opts?: RefreshOptions): Promise<RepoStatus>;
  searchSymbols(q: string, opts?: SearchOptions): Promise<SymbolHit[]>;
  graph(req: GraphRequest): Promise<GraphSlice>;
}
```

`revealInEditor` is a host capability, not a core API. It lives on the Tauri bridge and is implemented as a Rust command. The CLI has no editor reveal.

Defaults:

- `direction: 'in'`, `depth: 1`, `maxNodes: 500`.
- `depth` clamped to 1 to 5. A request outside the range is clamped, and the result's `effectiveDepth` says so.
- `maxNodes` clamped to 2,000.
- `limit` clamped to 50.

Validation:

- Core exports `validateApiParams(method, params)` built from zod schemas.
- Every transport calls it before the session call. Error code `INVALID_INPUT` with the zod path in `details`.
- The renderer's client also validates, so a type mismatch fails in the renderer's console during development.

## 9. Trail adapter

The adapter is the highest-risk module in the phase. Build it first, test it hardest.

### 9.1 Behavior

```ts
interface TrailAdapter {
  version(): Promise<string>;
  status(): Promise<TrailStatus>;
  build(opts: { onProgress?: (line: string) => void; signal?: AbortSignal }): Promise<void>;
  callers(req: {
    symbol: string;
    direction: 'in' | 'out';
    depth: number;
    noRefresh: boolean;
    pathPrefix?: string;
    signal?: AbortSignal;
  }): Promise<TrailCallersResult>;
  ask(req: { query: string; limit: number; noRefresh: boolean; signal?: AbortSignal }): Promise<TrailAskResult>;
}
```

Rules:

- `version()` runs once per session. A semver range check rejects unsupported versions before any query.
- `status()` calls `trail status <root> --json` with a 10 s timeout.
- `build()` runs `trail build <root>`, streams stdout lines, and resolves on exit 0. It is cancellable.
- `callers()` always passes `--json` and, after the first status check in a request, `--no-refresh`.
- `ask()` always passes `--json --limit`.
- All output is validated with zod. Unknown fields are stripped. A missing required field fails with `TRAIL_FORMAT_UNSUPPORTED`, including the field path and a 200-character excerpt.
- Span strings are parsed once. A bad span fails the response rather than producing line 0.
- `multi` matches: return all roots. The API decides whether to collapse or throw `AMBIGUOUS_SYMBOL`.

### 9.2 Process runner

```ts
interface ProcessSpec {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  env?: Record<string, string>;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  code: number;
  durationMs: number;
}
```

Rules:

- `spawn` with `shell: false`, `windowsHide: true`.
- stdout and stderr are buffered up to 8 MB each. Beyond that, the process is killed with `TRAIL_OUTPUT_LIMIT` rather than consuming memory.
- On timeout: SIGTERM, wait 2 s, SIGKILL.
- On abort: same sequence, reject with `CANCELLED`.
- ENOENT maps to `TRAIL_MISSING` or `GIT_MISSING` by command.
- On non-zero exit, `details` holds `code`, `signal`, and the last 2,000 characters of stderr.
- No shell metacharacters, no string concatenation of arguments.

### 9.3 JSON fixtures

For each supported Trail version, record:

```text
test/fixtures/trail/0.28.0/status.json
test/fixtures/trail/0.28.0/callers-add.json
test/fixtures/trail/0.28.0/callers-ambiguous.json
test/fixtures/trail/0.28.0/ask-total.json
test/fixtures/trail/0.28.0/skeleton-math.json
test/fixtures/trail/0.28.0/build-check-stale.json
```

The fake Trail binary reads `FAKE_TRAIL_SCENARIO` and returns the matching fixture with the matching exit code. This tests:

- success
- ambiguous match
- missing symbol (exit 1, empty JSON)
- invalid JSON
- timeout (sleep)
- version too old
- stderr-only failure

The real Trail test is opt-in with `REINS_TRAIL_E2E=1`. It copies `graph-basic` to a temp directory, runs `trail build`, then asserts the real adapter returns the same normalized slice as the golden fixture. It is skipped when Trail is absent, and CI reports it as skipped, not passed.

### 9.4 Fingerprint

```ts
async function computeFingerprint(input: {
  trailVersion: string;
  nodes: number;
  inSync: boolean;
  gitHead: string | null;
  gitDirty: boolean;
  adapterVersion: string;
  contractVersion: number;
}): Promise<string>
```

Implementation: SHA-256 over a newline-joined, fixed-order string, using Web Crypto (`crypto.subtle.digest`) so core stays free of `node:crypto`. No JSON serialization for the hash input, so key order cannot affect it. The fingerprint is computed on `status()` and cached for 5 s. It is included in every `GraphSlice.revision`.

When Git is unavailable, `gitHead` is `null` and `gitDirty` is `false`. The app reports this in status; it does not fail.

## 10. Desktop

### 10.1 Tauri Rust shell

Responsibilities:

- Create one window (1,280 x 820 minimum 960 x 640) with the system webview.
- Expose four commands: `open_repository`, `reins_invoke`, `close_repository`, and `reveal_in_editor`.
- Open a repository only through the native dialog plugin or a path passed by the test harness.
- Spawn one Node sidecar per repository and kill it on close.
- Forward each command to the sidecar as one JSON line and return one envelope.
- Own editor reveal. Build the URL and call the platform opener.
- Keep no graph, diff, or knowledge logic in Rust.

Command sketch:

```rust
#[tauri::command]
async fn reins_invoke(state: State<'_, AppState>, method: String, params: Option<Value>) -> Result<Value, String> {
    match request(state.inner(), &method, params.unwrap_or(Value::Null)).await {
        Ok(data) => Ok(json!({ "contractVersion": 1, "ok": true, "data": data })),
        Err(message) => Ok(json!({ "contractVersion": 1, "ok": false, "error": { "code": "INTERNAL", "message": message } })),
    }
}
```

### 10.2 Node sidecar

`apps/cli/src/serve.ts` reads newline-delimited JSON from stdin, calls `RepoSession`, and writes one response per request. It shares the same session implementation as the CLI and MCP. The sidecar is built to `apps/cli/dist/serve.js` and spawned by Rust with a fixed script path. No shell, no HTTP port.

### 10.3 Renderer

State: one `AppStore` with `repo`, `status`, `selection`, `query`, `graph`, `errors`, `loading`. Implemented with `useSyncExternalStore` and a subscribe function. No context for data, only for the client and theme.

Screens:

- **Launcher**: recent repositories, "Open folder", Trail requirement note.
- **Workspace**: left rail (search, graph root), center graph, right details, top status strip.
- **Empty states**: no repository, no graph, no results, Trail missing, graph stale.
- **Error states**: typed error card with code, message, retry action, and a copy-details button. No raw stack.

The first paint must show the app shell and status skeleton, not a blank window.

### 10.4 GraphView

Props:

```tsx
<GraphView
  root={{ symbolId: string } | { query: string }}
  direction="in"
  depth={1}
  maxNodes={500}
/>
```

Behavior:

- Fetches on mount and when root, direction, depth, or maxNodes changes. Aborts the previous request.
- Converts `GraphSlice` to React Flow nodes and edges. Node label: name; sublabel: `path:line`; type color from kind.
- Layout with dagre, `rankdir: 'TB'`, fixed node size, deterministic ordering from the slice. Layout runs in a `useMemo`; no animation on first render.
- Fits the view once per new slice, then preserves the user's viewport on expansion.
- Selecting a node calls `onNavigate({ type: 'symbol', id })`. Double-click calls `reveal`.
- Keyboard: Tab focuses nodes in layout order, Enter selects, arrow keys move focus along edges when the graph is focused.
- A list view toggle renders the same nodes as a table. This is the accessible fallback and is also faster for screen readers.
- Truncation banner: "Showing 500 of N nodes. Reduce depth or increase the cap." with a control.
- Stale banner: "Graph may be stale. Rebuild." with a build action.

Visual rules:

- Tokens for color, spacing, radius, typography. No hard-coded hex in components.
- Diff and graph states never encode meaning by color alone; each has a label or icon.
- Light, dark, and system themes are tested before the phase ends.
- No animation beyond viewport transitions; respect `prefers-reduced-motion`.

## 11. Testing

| Layer | Tests | Tool |
| --- | --- | --- |
| Core unit | Config, errors, span parsing, clamp, sort, fingerprint stability, envelope | Vitest |
| Core contract | Trail JSON to normalized slice; golden JSON files | Vitest |
| Node unit | Path containment, process runner timeout and abort, cache atomicity | Vitest |
| Adapter contract | Fake Trail scenarios, including invalid JSON and version mismatch | Vitest |
| Adapter integration | Real Trail on `graph-basic`, opt-in | Vitest, `REINS_TRAIL_E2E=1` |
| CLI | Exit codes, JSON output, stderr on error, `--help` | Vitest spawning the built CLI |
| Boundary | Forbidden imports fail; allowed graph passes | `scripts/check-boundaries.ts` |
| Budget | LOC cap and dependency allowlist | `scripts/check-budget.ts` |
| Desktop smoke | Launch, window title, open fixture via test env, search, click a node, assert details | Tauri binary smoke |
| Manual demo | Section 14 script on a real repository | Recorded |

Rules:

- The smoke test overrides the repository path with `REINS_TEST_REPO` and skips the native dialog. The env variable is read only when `app.isPackaged === false` and `NODE_ENV === 'test'`.
- No network in tests. The fake Trail binary and fixtures are local.
- No sleep-based tests. Wait on an observable state with a timeout.
- Test names state the behavior, not the function. `returns TRAIL_FORMAT_UNSUPPORTED for unknown span` beats `parses span`.
- A bug fix adds a failing test first. A gate that cannot be automated is a manual line in the phase notes with the date and result.

Fixtures:

| Fixture | Contents | Used for |
| --- | --- | --- |
| `graph-basic` | 6 TS files, cross-file calls, one ambiguous name | Adapter, CLI, desktop smoke |
| `graph-monorepo` | 2 packages, barrel exports, path prefix filter | Depth and filter behavior |
| `graph-empty` | One file, no graft | Missing-graft state, error UI |
| `graph-large` | Generated at test time, 2,000 symbols | Benchmark and cap behavior |

`graph-large` is generated, not committed, to keep the repository small. The generator is deterministic with a fixed seed.

## 12. Quality gates

Root scripts:

```json
{
  "scripts": {
    "build": "pnpm -r build",
    "check": "pnpm lint && pnpm typecheck && pnpm boundaries && pnpm budget && pnpm test:unit",
    "lint": "biome check .",
    "format": "biome format --write .",
    "typecheck": "tsc -b --pretty false",
    "boundaries": "node --experimental-strip-types scripts/check-boundaries.ts",
    "budget": "node --experimental-strip-types scripts/check-budget.ts",
    "test:unit": "vitest run",
    "test:e2e": "pnpm --filter @reinss/desktop smoke",
    "bench": "node --experimental-strip-types scripts/bench/graph.ts"
  }
}
```

The exact Node flag for TypeScript scripts is settled when Node 22's support is verified. If `--experimental-strip-types` is not stable enough, compile the scripts with `tsc` instead. Do not add `tsx` for two scripts.

Budgets:

| Budget | Limit | Enforced by |
| --- | --- | --- |
| Production LOC | 5,000 | `check-budget.ts` |
| Runtime dependencies | 12 | `check-budget.ts` |
| Any type | 0 in public exports | `tsc` plus a grep check |
| Forbidden imports | 0 | `check-boundaries.ts` |
| Depth 2 query p95 | 250 ms | `scripts/bench/graph.ts` |
| Desktop cold start | 3 s | smoke test measurement |
| Bundle initial JS | 1.5 MB gzip | build output check |

LOC counting rules: count `packages/*/src/**/*.{ts,tsx}` and `apps/*/src/**/*.{ts,tsx}`, exclude `*.test.ts`, `*.test.tsx`, fixtures, generated files, and CSS. Report a per-package breakdown so a surprise is visible before the total fails.

Dependency counting rules: count `dependencies` in non-private packages plus `dependencies` in private apps, exclude `devDependencies` and workspace packages. Fail on a package not in the allowlist in section 6.

## 13. Work plan

### Week 1: contract and adapter

- Workspace, tsconfig references, Biome, Vitest, CI skeleton.
- `core`: config schema, `ReinsError`, API types, span parser, clamp and sort, fingerprint.
- `node`: process runner with timeout and abort tests.
- `node`: Trail adapter against recorded fixtures and fake binary.
- `node`: path containment with symlink and `..` tests.
- CLI `status` and `search`, JSON and text.

Exit for the week: `reins status --json` and `reins search` work against a real repository; adapter tests cover every error code it can emit.

### Week 2: graph and desktop slice

- `core`: callers normalization, dedupe, depth merge, cap.
- `node`: `RepoSession` and fingerprint cache.
- CLI `callers`, `callees`, `graph`, and `init`.
- Tauri shell, Node sidecar, repository dialog, status strip.
- `ui`: provider, client, `RepoStatus`, `GraphView` with dagre and list fallback.
- Editor reveal for VS Code, Cursor, and Zed.

Exit for the week: the demo path works manually; keyboard navigation works; stale and missing-graph states render correctly.

### Week 3: MCP, gates, and cleanup

- `reins mcp` with three tools and schema snapshots.
- Boundary and budget scripts; fix every violation.
- Desktop smoke test with Playwright.
- Benchmark script; record the first result.
- Delete dead code, merge tiny files, remove unused exports.
- `AGENTS.md`, two skills, docs updates.
- Demo run and phase notes.

If the phase runs long, cut MCP to `status` and `callers` only. Do not cut the boundary test, the budget, or the smoke test.

## 14. Demo script

Run this on a real repository, not only the fixture, and record it.

1. Launch the app from a clean state. The launcher shows the recent list and an "Open folder" action.
2. Open a TypeScript repository with a built Trail graph. The status strip shows `ready`, node count, Trail version, Git HEAD, and `in sync`.
3. Type a known function name in search. Results appear with path and line.
4. Select a result. The graph shows callers at depth 1. Node count and truncation state are visible.
5. Switch direction to `out` and depth to 2. The graph updates and preserves the viewport.
6. Select a caller, then open it in the editor. The editor opens the right file at the right line.
7. Switch to the list view with the keyboard only. Every action is reachable, focus is visible.
8. Open a repository without a graph. The app explains the state and offers "Build graph". Build progress appears line by line.
9. Run `reins callers <symbol> --json` in a terminal against the same repository. Compare node IDs with the UI.
10. Run `reins mcp`, call `reins_status`, `reins_symbols`, and `reins_callers` from an MCP client. Confirm the same revision and IDs.

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Trail JSON changes across minor versions | Adapter breaks without a code change. | Schema validation, per-version fixtures, min and max range, a contract test that runs against the installed version in CI when present. |
| Trail is slow on large repositories | Status and query budgets fail. | Cache status for 5 s, pass `--no-refresh` after one check, show progress, cap results. Report Trail slowness upstream rather than hiding it. |
| Tauri Rust becomes a second backend | Business logic leaks into commands. | Commands only validate and forward to the Node sidecar. Boundary test plus review. |
| React Flow bundle bloat | Cold start and memory budgets fail. | Lazy-load the graph route, split vendor chunk, measure at the end of Week 2. |
| pnpm or Node version mismatch on contributors' machines | Install fails. | `packageManager` and `engines` pinned; README states the tools; CI uses the same versions. |
| Editor URL schemes differ per platform | Reveal fails. | Phase 1 supports macOS only for reveal, with a typed `EDITOR_UNAVAILABLE` error elsewhere. Cross-platform in Phase 6. |
| Code budget forces awkward compression | Readability suffers. | Budget excludes tests and generated code; prefer deleting features over compressing code. Review the breakdown, not just the total. |

## 16. Definition of done

- All exit criteria checked with evidence.
- No `TODO` without an owner and a phase. Use `shortcut: <limit>, <when to upgrade>` for deliberate limits.
- No dead exports. `knip` is not installed; a manual pass plus the boundary test is enough for three packages and two apps.
- Every error path in the API has a test with the exact code.
- `AGENTS.md` commands match the scripts that exist.
- The phase notes record: date, commit, benchmark machine, p95 numbers, smoke result, demo recording path.
- The next phase's first task is written before the phase closes.

## 17. What Phase 1 deliberately leaves unfinished

- Surfaces, diff, and knowledge have contracts in `03` but no implementation.
- The graph is read-only and unlabeled beyond kind and path.
- There is no watcher, so status refresh is manual or on request.
- There is no settings screen; theme is read from config and the system.
- There is no packaging, update channel, or signing.
- There is no LLM code path at all, not even a disabled stub. The interface is designed in `06`; code arrives in Phase 6.

Leaving these out is the point. A smaller Phase 1 is what makes Phases 2 through 6 affordable.
