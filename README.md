# reins

A local-first desktop app and embeddable React component set for three jobs:

1. Read a repository's structure without re-parsing it by hand: symbols, callers, callees, blast radius, and the entry points users actually reach (APIs, pages, screens, CLI commands).
2. Keep the intent next to the code: specs, decisions, constraints, and "how we build here", linked to real symbols and diff ranges.
3. Review change by structure, not by line noise: moved, renamed, extracted, reformatted, and truly edited code, with a machine-readable form for agents.

Reins is built on [Trail](https://github.com/trailhq) as the code graph. It does not fork or reimplement Trail's parser or storage. It wraps Trail behind one adapter, then adds surfaces, semantic diff, knowledge, and review on top.

**Status: implemented MVP.** The workspace, core, Trail adapter, surface scanners, semantic diff, knowledge ledger, CLI, MCP server, embeddable React components, and Tauri shell exist. The desktop uses `Cmd+K` as its only navigation surface. Phase 6 hardening (watcher, packaging, Windows/Linux) remains.

## Documents

| File | Answers |
| --- | --- |
| [docs/01-product-spec.md](docs/01-product-spec.md) | What Reins is, who it serves, and what each release must do. Includes requirement IDs and acceptance criteria. |
| [docs/02-architecture.md](docs/02-architecture.md) | How the pieces fit: process model, packages, ports, API, storage, caching, security, budgets. |
| [docs/03-data-contracts.md](docs/03-data-contracts.md) | The JSON and file contracts: config, symbols, surfaces, semantic diff, knowledge notes, errors, cache, versioning. |
| [docs/04-roadmap.md](docs/04-roadmap.md) | Six phases with scope, exit gates, and what each phase refuses to build. |
| [docs/05-phase-1-foundation.md](docs/05-phase-1-foundation.md) | The detailed build plan for the small-codebase phase: layout, modules, tests, budgets, demo. |
| [docs/06-ai-harness.md](docs/06-ai-harness.md) | The agent layer: AGENTS.md, project skills, MCP tools, context packs, evaluation, approval gates. |
| [docs/07-decisions-and-risks.md](docs/07-decisions-and-risks.md) | Accepted architecture decisions, rejected ideas, open questions, risk register, spikes to run. |
| [AGENTS.md](AGENTS.md) | The rules an agent follows in this repository. |
| [RULES.md](RULES.md) | Package whitelist and performance rules. Read before adding a dependency or a scan. |

## Phase summary

| Phase | Outcome | Gate in one line |
| --- | --- | --- |
| 0 | Spec and decisions | Done. |
| 1 | Strong codebase and one vertical slice | Done: `pnpm check` green; open a repo, search a symbol, see callers. |
| 2 | Surfaces and graph exploration | Done: Express, Hono, Commander, Next.js, React Router, FastAPI detectors; flow view. |
| 3 | Semantic diff | Done: move, rename, reformat, modify, extract, add, remove; Git ranges. |
| 4 | Knowledge ledger | Done: notes, typed links, backlinks, spec-kit import, `reins check`. |
| 5 | Review workspace and embed | Done: diff, graph, knowledge in one view; components mount in a host React app. |
| 6 | Hardening and full agent layer | Partial: MCP, harness packs, and skills exist; watcher, packaging, Windows/Linux remain. |

The implementation follows the same boundaries the spec set: one Trail adapter, one API, one knowledge source, one diff engine.

## Product principles

- **Wrap, do not rebuild.** One adapter owns Trail. One diff engine owns AST comparison. One knowledge parser owns markdown. No parallel implementations.
- **Local and deterministic by default.** No network call is required to index, search, graph, diff, or check knowledge. An LLM is an explicit opt-in, never a silent dependency.
- **One API, three transports.** The same operations answer the CLI, the desktop Tauri bridge, and MCP. No transport-specific business logic.
- **Embed-first UI.** Every major view is a React component with an injectable client. `node:*`, Tauri, and filesystem imports stay out of the UI packages.
- **Progressive disclosure.** Structural answers first. Optional prose summaries and LLM suggestions come later and are labeled as suggestions.
- **Small code wins ties.** When two designs solve the same problem, the one with fewer packages, fewer dependencies, and fewer states ships.

## Non-goals

- Hosted service, accounts, sync, or remote storage.
- A general-purpose IDE, text editor, or language server.
- Type inference across a whole program.
- Replacing Git, pack files, or the user's editor.
- Reimplementing Trail's parser, graph storage, or learnings format.
- Multiplayer editing in the first releases.
- Running repository code during indexing or diffing.

## Run

```bash
pnpm install
pnpm build
pnpm dev                 # Tauri app
pnpm test                # 26 unit and integration tests
pnpm typecheck
```

CLI:

```bash
# after publishing
npx reins status <repo> --json

# before publishing, run the local package through npx
npx --yes --package ./apps/cli reins status <repo> --json

# or use the local build directly
pnpm reins status <repo> --json
./bin/reins status <repo> --json
```

The same commands work for `init`, `search`, `callers`, `callees`, `graph`, `surfaces`, `flow`, `diff`, `notes`, `note`, `propose`, `check`, `pack`, `spec`, and `mcp`.

Publish the three public packages:

```bash
pnpm release:dry
pnpm release
```

`reins` is the CLI package. `@reins/core` and `@reins/node` are its dependencies. `@reins/ui` and the desktop app stay private for now.

Desktop: open a repository, then press `Cmd+K` (or `Ctrl+K`). There is no top bar. The Mantine Spotlight palette is the only navigation. Recent tools are saved locally. The center area shows one tool at a time.

The Tauri shell spawns `apps/cli/dist/serve.js` as its sidecar. `pnpm dev` builds it first. If you run the Tauri binary directly, run `pnpm --filter reins build` once. Override the path with `REINS_SERVE_SCRIPT=/absolute/path/to/serve.js`.

Embed:

```tsx
import { ReinsProvider, ReviewWorkspace, type ReinsClient } from '@reins/ui';
import '@reins/ui/styles.css';

export function Review({ client }: { client: ReinsClient }) {
  return (
    <ReinsProvider client={client}>
      <ReviewWorkspace range={{ mode: 'working' }} />
    </ReinsProvider>
  );
}
```

The host supplies the client. The desktop uses the Tauri invoke client; a web host can supply its own transport. No component imports Tauri or Node.

Requirements: Node 22 or newer, pnpm 10, Trail 0.28 or newer, Git 2.30 or newer. The desktop uses Tauri with the system webview and a Node sidecar. Rust and the Tauri CLI are required for desktop work.

Current machine note: `trail` is installed at `/Users/tuevo/.volta/bin/trail` (0.28.0). The `pnpm` shim resolves to Volta but no pnpm toolchain is installed, so `pnpm --version` fails. The build in this session used `npx pnpm@10` with a local store.

## Reading order

For product intent, read `01` then `04`. For implementation, read `02` then `03` then `05`. For agent work, read `AGENTS.md` then `06`. `07` records why the design looks this way and what is still unproven.
