# RULES.md

The package whitelist and the performance rules for Reins. Read this before adding a dependency or a scan.

## 1. Build on, do not rebuild

| Area | Foundation | Rule |
| --- | --- | --- |
| Code graph | [Trail](https://github.com/trailhq) | Use `trail` CLI JSON through `packages/node/src/trail.ts`. Never parse `graft/` internals, never fork Trail. |
| Specs | [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) | Read `openspec/config.yaml`, `openspec/project.md`, `openspec/specs/**/spec.md`, and `openspec/changes/**/{proposal,design,tasks,spec}.md` as read-only knowledge notes. Do not copy OpenSpec templates into this repo. |
| Review UI | React, embeddable | Every view is a React component with an injected `ReinsClient`. The review workspace is a component, not a page. |
| Desktop | Tauri | Rust shell, system webview, and one Node sidecar over stdio. The sidecar is the same `RepoSession` used by the CLI and MCP. |
| Graph canvas | `@xyflow/react` + `dagre` | Do not write a graph renderer. |
| Code view | CodeMirror 6 | Do not write a syntax highlighter. |
| Command palette | `@mantine/spotlight` | Do not write a fuzzy list. |
| Markdown | `react-markdown` + `remark-gfm` | Do not write a markdown renderer. |
| Parsing | `@babel/parser` | Do not write a JS/TS parser. |
| File discovery | `fast-glob` | Do not write a directory walker. |
| Frontmatter | `gray-matter` | Do not write a YAML frontmatter splitter. |
| Validation | `zod` | Do not hand-validate external JSON. |
| CLI | `commander` | Do not hand-parse argv. |
| MCP | `@modelcontextprotocol/sdk` | Do not hand-roll JSON-RPC. |
| Line diff fallback | `diff` | Do not write an LCS implementation. |

## 2. Allowed packages

### Runtime

| Package | Used in | Purpose |
| --- | --- | --- |
| `@tauri-apps/api` | desktop | Tauri invoke bridge. |
| `@tauri-apps/plugin-dialog` | desktop | Native folder picker. |
| `react`, `react-dom` | ui, desktop | UI runtime. |
| `@xyflow/react` | ui | Graph canvas. |
| `dagre` | ui | Deterministic graph layout. |
| `@mantine/core` | ui, desktop | Components, theme, layout primitives. |
| `@mantine/hooks` | ui, desktop | Hotkeys and small UI hooks. |
| `@mantine/spotlight` | desktop | `Cmd+K` command palette. |
| `@tabler/icons-react` | ui, desktop | Interface icons. |
| `@uiw/react-codemirror` | ui | Code view. |
| `@uiw/codemirror-theme-github` | ui | GitHub light and dark code themes. |
| `@codemirror/view`, `@codemirror/state` | ui | CodeMirror extensions and line decorations. |
| `@codemirror/lang-javascript` | ui | JS/TS highlighting. |
| `@codemirror/lang-json` | ui | JSON highlighting. |
| `react-markdown` | ui | Note preview. |
| `remark-gfm` | ui | Tables and task lists. |
| `clsx` | ui | Conditional class names. |
| `zod` | core, node | Schemas and validation. |
| `commander` | cli | Commands and flags. |
| `@modelcontextprotocol/sdk` | node | MCP server. |
| `fast-glob` | node | File discovery. |
| `gray-matter` | node | Markdown frontmatter. |
| `@babel/parser` | node | JS/TS AST for surfaces and diff. |
| `diff` | node | Unified diff for proposals. |

### Development

`typescript`, `tsup`, `vitest`, `@biomejs/biome`, `@tauri-apps/cli`, `vite`, `@vitejs/plugin-react`, `postcss-preset-mantine`, `postcss-simple-vars`, `tsx`, `@types/node`, `@types/react`, `@types/react-dom`, `@types/dagre`.

### Not allowed

| Package or approach | Why |
| --- | --- |
| `tldraw` as a runtime dependency | License and release coupling. Embeddable components are the contract; a tldraw example may live in `examples/` only. |
| SQLite, `better-sqlite3`, `sql.js` | Trail is the only graph store. Caches are JSON. |
| `zustand`, Redux, Jotai | One `useSyncExternalStore` store is enough. |
| `minisearch`, Fuse, Lunr | Linear scan over notes is enough at the stated scale. |
| ESLint, Prettier, turbo | Biome and `pnpm -r` cover the need. |
| `execa` | `node:child_process.spawn` with an argument array is the requirement. |
| A custom parser, graph renderer, diff algorithm, or markdown renderer | Use the listed package. |

Adding a package requires a row in this file, a catalog entry, and a reason in the pull request. Removing a package is always allowed.

## 3. Performance rules

The desktop must open a repository without reading it.

### On open

- Read `.reins/config.json` only.
- Run `trail status --json` and `git rev-parse` / `git status --porcelain`.
- Count knowledge files with a glob, but do not parse them.
- Do not walk the source tree.
- Do not read source files.
- Do not load the graph into memory.
- Do not scan surfaces.

### On demand

- Graph queries call Trail and return a capped slice. The graph is never materialized as a whole.
- Surface scan runs only when the Surfaces view or `reins surfaces` is called. It streams file paths with `fast-glob`, reads one file at a time, skips files over 1 MB, and caches the result in `.reins/.cache/surfaces.json`.
- Knowledge notes load only when the Knowledge view, `reins notes`, `reins check`, or a pack is requested.
- Diff reads only the changed files in the selected range, one at a time.
- `readFile` reads one file for the code viewer.

### Caps

| Item | Cap |
| --- | --- |
| Graph nodes per response | 500 default, 2,000 hard |
| Graph depth | 5 |
| Surface scan files | 20,000 |
| Surface page | 1,000 |
| Diff files | 200 |
| Diff file size | 1 MB |
| Knowledge notes per list | 200 |
| MCP graph nodes | 300 default |
| MCP diff operations per file | 100 default |
| Harness pack | 4,000 tokens default, 12,000 hard |

### Caching

- Cache only derived data under `.reins/.cache/`.
- Cache keys include the graph fingerprint and detector version.
- Do not cache when Git is unavailable, because there is no reliable invalidation signal.
- A corrupt cache is deleted and rebuilt, never repaired.
- Never store absolute paths in a cache except local session state.

### Forbidden

- Reading every file to build a symbol list.
- Loading the whole repository into memory.
- Spawning Trail once per file for a scan.
- Re-scanning surfaces on every render.
- Blocking the Tauri UI or the Node sidecar on parsing or diffing.
- A background scan without a user action.

## 4. UI rules

- Every major view is a component in `@reins/ui` with a `ReinsClient`.
- No `node:*`, Tauri, or filesystem import in `@reins/ui`.
- The desktop shell owns the window, the repository dialog, and editor reveal. The components own the views.
- `Cmd+K` is the only navigation. The Mantine Spotlight palette lists tools, recent tools, and repository actions.
- No top bar. The center area shows one tool at a time. No permanent sidebar.
- Mantine is the component and theme layer. Use Mantine primitives before custom CSS.
- Apple-style tokens: system font stack, 12 to 16 px radii, hairline borders, generous whitespace.
- Default light paper theme: `#e6d2a3` page, `#f8efdc` surfaces, `#2b2418` ink, `#6f5f45` muted, `#1f5f8b` accent.
- Dark theme: `#171816` page, `#1f201d` surfaces, `#ecece6` ink, `#4dabf7` accent. The bottom-left toggle switches themes and Mantine persists the choice.
- `MantineProvider` lives inside `ReinsProvider`. A host does not need its own provider.
- Loading, empty, error, and truncated states are implemented.
- Keyboard reachable, visible focus, AA contrast, no color-only meaning.

## 5. Desktop rules

- Rust owns the window, the native dialog, and the sidecar process. It does not contain graph, diff, or knowledge logic.
- The Node sidecar speaks newline-delimited JSON over stdio. One request, one response, one id.
- The renderer calls `invoke` only through `apps/desktop/src/renderer/client.ts`.
- The sidecar is built from `apps/cli/src/serve.ts` and shares `RepoSession` with the CLI and MCP.

## 6. Data rules

- Trail node IDs are the only symbol identity.
- Surface IDs follow `docs/03-data-contracts.md` section 5.
- Knowledge notes are committed markdown. Caches are disposable.
- Agent proposals go to `.reins/knowledge/inbox/` with `status: proposed`.
- Accepted notes are never edited by an agent without a human request.
- OpenSpec files are read-only and marked `source: openspec`.

## 7. Verification

Before claiming a change is done:

```bash
pnpm typecheck
pnpm test
pnpm build
```

For a UI change, run the desktop app and exercise the changed view. For a Trail change, run the adapter tests against the installed Trail version. For a performance change, record the measurement, not an impression.
