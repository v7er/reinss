# 01. Product specification

Reins is a local workspace for code structure, project intent, and structural review. It runs as a desktop app, a CLI, an MCP server for agents, and a set of React components that can be embedded in another host.

This document states what the product must do. [02. Architecture](02-architecture.md) states how it is built. Requirement IDs here are stable and are cited by phase gates and tests.

## 1. Vision

A developer opens a repository and immediately sees:

- the entry points that matter (HTTP routes, pages, screens, exported package interfaces),
- the call path behind any one of them, with exact file and line references,
- the decisions and constraints that govern the code they are about to touch,
- a review of their change that says "this function moved and was renamed, the body is unchanged" instead of a wall of red and green lines.

An agent gets the same answers through MCP in one call, with bounded output, instead of spending its context rediscovering the repository.

## 2. Problem

Three failures repeat in agent-assisted development.

**Structure is rediscovered, not queried.** Agents and humans read files to learn what calls what. The repository already contains that graph, but it is not exposed as a queryable, stable surface. Every session pays the same cost.

**Intent is lost between code and conversation.** Decisions live in chat threads, commit messages, and one person's memory. An agent that can see every symbol but not the constraint "refunds write to the ledger first" will confidently violate it.

**Diff is line-shaped, not structure-shaped.** Moving one function produces a delete and an add. Renaming a parameter produces noise across a file. A reviewer cannot see the two real changes inside a 400-line diff.

## 3. Users and jobs

| User | Job | Reins answer |
| --- | --- | --- |
| Application developer | "What reaches this route, and what breaks if I change it?" | Surfaces, callers, callees, blast radius with file:line. |
| Reviewer | "What actually changed in this PR?" | Semantic operation list plus structural before and after. |
| Tech lead | "Why is it built this way, and does this change follow it?" | Decisions and constraints linked to code, plus `reins check`. |
| AI agent | "Give me the minimum context to make a correct change." | MCP tools, bounded results, harness pack. |
| Tool builder | "Put this view in my own app or canvas." | React components with an injected client and navigation events. |

Primary persona: a developer working with one coding agent in a local repository. The product is optimized for one user, one machine, no account.

## 4. Product surfaces

| Surface | Form | Ships in |
| --- | --- | --- |
| Desktop app | Tauri window with repo session, graph, surfaces, diff, knowledge, review | Phase 1 (minimal), completed across phases |
| CLI | `reinss` binary | Phase 1 |
| MCP server | `reins mcp` over stdio | Phase 1 (three tools), completed Phase 5 |
| Embeddable UI | `@reinss/ui` React components | Phase 1 (GraphView), expanded Phase 5 |
| Knowledge files | Markdown under `.reins/knowledge/`, plus read-only OpenSpec under `openspec/` | Phase 4, contract fixed Phase 1 |

## 5. Functional requirements

Legend: **M** must have for the product to be useful, **S** should have, **C** could have. Phase assignments are in the roadmap, not duplicated here.

### 5.1 Repository session

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| REPO-1 | M | Open a local folder or Git repository. | The app validates the folder, persists the last repository in local state, and reopens it on launch. |
| REPO-2 | M | Detect Trail and its graph. | Status reports one of `ready`, `missing-trail`, `missing-graft`, `stale`, `unsupported-version`, with the detected versions. |
| REPO-3 | M | Build or refresh the graph on explicit user action. | A button or CLI command runs `trail build`, streams progress, and reports success or the Trail error verbatim. Nothing builds silently in the background. |
| REPO-4 | M | Refuse to run when the graph is stale without saying so. | Any graph-backed answer includes `graph: { inSync, checkedAt }`; the UI shows a stale banner with a refresh action. |
| REPO-5 | S | Remember recent repositories and per-repo layout. | Recent list of five; layout persisted per repository path. |
| REPO-6 | S | Support a monorepo. | Surfaces and symbols are filterable by path prefix; no assumption of a single package. |

### 5.2 Structure and graph

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| GRAPH-1 | M | Search symbols by name, qualified name, or plain query. | Results carry node ID, kind, path, line range, and a stable ranking; empty query returns an empty result, not an error. |
| GRAPH-2 | M | Show callers and callees for a symbol. | Depth 1 to 5, direction in, out, or both; every row includes file:line and the Trail node ID. |
| GRAPH-3 | M | Show a blast radius for a symbol or diff. | Transitive walk with a node and depth cap, a `truncated` flag, and deterministic ordering. |
| GRAPH-4 | M | Render the graph interactively. | Pan, zoom, select, expand one hop, and open a node's source range in the editor. Layout is deterministic for the same input. |
| GRAPH-5 | S | Filter by language, package, directory, and relation kind. | Filters apply before layout; the visible count is shown. |
| GRAPH-6 | S | Offer a large-graph mode. | Above 1,500 visible nodes, the view switches to an aggregated or canvas renderer without freezing the UI. |
| GRAPH-7 | C | Pin and compare two graph slices. | Two slices render side by side; selection is independent. |

### 5.3 Surfaces

A surface is a user-reachable entry point: an HTTP route, a CLI command, a page, a screen, or a package export.

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| SURF-1 | M | Discover HTTP and CLI surfaces for supported frameworks. | Express or Hono plus Commander in Phase 2; each detection includes framework, method, route, handler symbol, file, line, and confidence. |
| SURF-2 | M | Discover page and screen entry points for supported frameworks. | Next.js App Router and React Router in Phase 2; each detection includes route, component file, and the component symbol when resolvable. |
| SURF-3 | M | Link every surface to a graph node when one exists. | `symbolId` is a real Trail node ID or `null` with a reason; no invented IDs. |
| SURF-4 | M | List and filter surfaces. | Filter by kind, framework, path, and confidence; counts are exact for the current filter. |
| SURF-5 | M | Trace a flow from a surface. | Route to handler to callees in one view, with the same depth and confidence controls as GRAPH-2. |
| SURF-6 | S | Honor OpenAPI and Swagger documents when present. | JSON specs are marked `evidence: openapi` and deduplicated against code-detected routes; a code route wins. An `x-source-file` extension links the surface to its handler file or symbol, resolved from the spec folder or its nearest ancestor that contains the file. Append `@function` for a function or `@Class:method` for a class method; a class-only `@Class` also traces constructor-injected classes one level out. YAML specs remain open. |
| SURF-7 | S | Add a detector without touching the engine. | A detector is a separate module with a fixture; registering it requires one line and one test file. |
| SURF-8 | C | Discover package exports as public interfaces. | Workspace packages list exported symbols and their consumers. |
| SURF-9 | M | Group surfaces by C1 component. | Components are discovered from workspace manifests; each surface carries a `componentId`; the five named kinds are webapp, mobile, backoffice, core, and cli. |
| SURF-10 | S | Show which surfaces a Git range changed. | A surface reports `change.status` and `change.touched`; `touched` is true only when the surface line falls inside a changed hunk. |

Surface IDs and detector contracts are in [03. Data contracts](03-data-contracts.md#5-surfaces).

### 5.4 Semantic diff

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| DIFF-1 | M | Parse both sides of a change with a structural parser. | TypeScript and JavaScript use `@babel/parser`; other languages degrade to a line diff until a Tree-sitter grammar lands. Parse failure degrades explicitly, never silently. |
| DIFF-2 | M | Detect moves. | A definition with an identical normalized subtree at a different path or position is reported as `moved`, not as delete plus add. |
| DIFF-3 | M | Detect renames. | A definition whose subtree is equal but whose name changed is `renamed`, with old and new names. |
| DIFF-4 | M | Detect real edits. | Changed bodies are `modified` with before and after spans and a compact token-level summary. |
| DIFF-5 | M | Detect reformat-only changes. | Equal token streams with different whitespace, comments, or line breaks are `reformatted`, never `modified`. |
| DIFF-6 | M | Detect extraction and inlining. | A new function whose body came from the old body, with the old site now calling it, is `extracted`; the reverse is `inlined`, both with confidence. |
| DIFF-7 | M | Produce a deterministic JSON result. | Same inputs, parser versions, and options produce byte-identical JSON after key ordering. |
| DIFF-8 | M | Show a structural diff view. | Operations grouped by file; selecting one reveals before and after with the changed node highlighted. The code panel also shows a line-level unified diff with `+` and `-` markers computed from both sources, not from Git. |
| DIFF-9 | M | Support working tree, staged, commit range, and branch versus base. | Each range resolves through Git and reports the resolved commit SHAs. |
| DIFF-10 | S | Support watch mode. | A file save updates only the changed file's result within 500 ms; the view keeps scroll position. |
| DIFF-11 | S | Link a changed symbol into the graph and surfaces. | One click opens the graph centered on that node or the surface that reaches it. |
| DIFF-12 | C | Explain a change in one sentence. | The sentence is generated only when the user enables an LLM; otherwise it is composed from the operation list. |

The operation vocabulary and matching order are in [03. Data contracts](03-data-contracts.md#6-semantic-diff).

### 5.5 Knowledge ledger

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| KNOW-1 | M | Store knowledge as a committed markdown tree under `.reins/knowledge/`: one node per intent, the directory is the component or boundary, `_` files are guidance, `template.md` declares layers. Read OpenSpec under `openspec/` as read-only knowledge. | A node is readable and editable without Reins; the template declares layers and required fields; guidance is never listed as a node; OpenSpec is never written. |
| KNOW-2 | M | Support node types: spec, decision, constraint, how-to, question. | Each type validates against a schema; an unknown type is rejected with a path and field. |
| KNOW-3 | M | Link nodes to nodes, symbols, surfaces, commits, and files. | Links are stored in frontmatter, validated on load, and resolvable in both directions. |
| KNOW-4 | M | Show backlinks. | Opening a node lists every node, symbol, and surface that references it. |
| KNOW-5 | M | Search nodes by meaning without a model. | BM25 with field boosts, committed aliases, and intent routing; results carry address, score, and excerpt; rank is deterministic. |
| KNOW-6 | M | Tree and detail view of knowledge. | Nodes render by component with coverage state; position is not stored in the node. |
| KNOW-7 | M | Validate the ledger. | `reins check` reports invalid frontmatter, duplicate addresses, broken links, unknown symbols and surfaces, stale code links, missing templates, undeclared layers, and component mismatches. |
| KNOW-8 | M | Agent proposals require human review. | A proposed node lands in `knowledge/inbox/` with `status: proposed`; acceptance is an explicit action that moves it to a component and leaves a reviewable Git diff. |
| KNOW-9 | S | Link a review comment to a node. | A comment can be promoted to a node draft with the file, line, and diff context prefilled. |
| KNOW-10 | S | Detect constraint violations in a diff. | For each constraint node with a machine-checkable rule, report pass, fail, or not-applicable against the diff. |
| KNOW-11 | C | Track node history. | Git history is the history; the app links to the commit that last changed a node. |
| KNOW-12 | M | Author nodes in a studio. | A tree of components, a node editor driven by `template.md`, validation before save, a diff, and a human acceptance gate. |
| KNOW-13 | M | Bootstrap a tree from an existing repository. | A preview plan from the Trail graph; writes only `proposed` nodes, the template, and component stubs, and only after an explicit write flag. |
| KNOW-14 | M | Keep knowledge and code in sync. | Coverage per component: covered, stale, orphan, unmapped, invalid, with a fix suggestion and no auto-edit. |
| KNOW-15 | S | Discuss a node. | Comments live in Git notes under `refs/notes/reins`; the app reads them, writes only on an explicit human action, and never pushes. |
| KNOW-16 | M | Expose knowledge to agents. | `reinss ask`, `reinss knowledge context <path>`, and MCP search, get, context, coverage tools with token caps and one write path. |
| KNOW-17 | S | Offer built-in knowledge templates. | `default`, `minimal`, `c4`, and `domain` presets parse, create their layers, and keep an existing template instead of overwriting it. |
| KNOW-19 | S | Configure a local model from the desktop. | Settings probes loopback providers, lists models, saves the choice, and shows whether a key is present; saving preserves the rest of the config. |
| KNOW-20 | S | Initialize knowledge from the desktop. | Studio offers template choice, code scan preview, optional AI drafting, a preview before write, and reloads the tree after writing. |
| KNOW-18 | S | Draft nodes from code and specs with an opted-in model. | Disabled by default; requires config and an API key; previews the prompt; writes only proposed nodes; a failed request writes nothing. |

The node schema and lifecycle are in [03. Data contracts](03-data-contracts.md#7-knowledge-nodes). The OpenSpec import is in [03.9](03-data-contracts.md#79-openspec-import).

### 5.6 Review workspace

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| REV-1 | M | Show diff, graph context, and linked knowledge in one layout. | Three panes share one selection; selecting a change updates the graph and the knowledge list. |
| REV-2 | M | Comment on a structural change or a line. | Comments persist in local state for the session and can be exported; they are not written into the repository without an explicit action. |
| REV-3 | M | Promote a comment to a knowledge draft. | Prefills type, links, file, and line; lands in the inbox. |
| REV-4 | S | Navigate by operation. | Keyboard next and previous across operations, not lines. |
| REV-5 | S | Show a change risk summary. | Counts by operation type, touched surfaces, and constraints at risk. |

### 5.7 Embed and integration

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| EMBED-1 | M | Ship every major view as a React component. | Components accept data or a client, never read files directly, and render in a plain React app. |
| EMBED-2 | M | Accept an injected client. | A host can provide its own transport; the default client is optional. |
| EMBED-3 | M | Emit navigation events instead of forcing a route. | `onNavigate` receives a typed target; clicking a symbol without a handler does not crash. |
| EMBED-4 | M | Support light, dark, and system themes. | All components use tokens; no hard-coded page background. |
| EMBED-5 | S | Provide a custom element wrapper for non-React hosts. | One custom element per major view, documented with attributes and events. |
| EMBED-6 | S | Work inside a tldraw host. | A documented example mounts the components as shapes; tldraw is not a dependency of Reins. |
| EMBED-7 | C | Work inside a VS Code webview. | A sample extension loads the built assets and talks over the same client interface. |

### 5.8 CLI and agent interface

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| CLI-1 | M | Every query has a JSON mode. | `--json` output validates against the documented schema; errors go to stderr with a stable code. |
| CLI-2 | M | Exit codes are stable. | `0` success, `1` user or query error, `2` environment error, `3` limit exceeded, `4` internal error. |
| CLI-3 | M | `reins init` prepares a repository. | Creates `.reins/` config and knowledge folders, checks Trail, runs `trail init` only with consent, and never overwrites an existing config. |
| MCP-1 | M | Expose graph, surface, knowledge, and diff operations over MCP. | Tool schemas match the core API; results are token-capped; every result names the repository and graph revision. |
| MCP-2 | M | Write nothing without an explicit proposal path. | The only write tool is `reins_knowledge_propose`; it writes to the inbox and returns a diff. |
| MCP-3 | S | Emit a context pack. | `reins_harness_pack` returns deterministic markdown under a token budget. |

Tool-by-tool contracts are in [06. AI harness](06-ai-harness.md#4-mcp-tools).

### 5.9 Git GUI

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| GIT-1 | M | Show working tree status. | Every file reports staged, unstaged, untracked, or conflicted, with line counts when available. |
| GIT-2 | M | Stage, unstage, and discard. | File-level operations return the new status; discard requires explicit confirmation. |
| GIT-3 | M | Commit. | Message, amend, and sign-off; an empty message fails with `GIT_COMMIT_EMPTY`. |
| GIT-4 | M | Show history as a graph. | A Canvas tree draws lanes, merge parents, branch, remote, and tag refs; selecting a commit opens its semantic diff against its parent. |
| GIT-5 | M | Keep destructive operations explicit. | No force push, no silent discard, no network call without a user action. Branch, tag, and worktree deletes require confirmation. |
| GIT-6 | M | Manage branches. | Local and remote branches list with upstream, ahead, and behind. Checkout, create, and delete are explicit actions. |
| GIT-7 | M | Manage tags. | Tags list with annotated or lightweight status. Create and delete are explicit actions. |
| GIT-8 | M | Manage worktrees. | Worktrees list with path, branch, head, current state, and whether the branch is merged into main. Every row carries a worktree badge; a branch with no same-name remote is marked no remote. Add and remove are explicit actions; the current worktree cannot be removed. |
| GIT-9 | M | Review in one tab. | Diff and review share one range and one tab. The diff shows what changed; the review side shows graph context and knowledge. |
| GIT-10 | S | Show git-appraise reviews. | When the repository has git-appraise notes, the Git tool lists reviews and the homepage lists open reviews that need the current user. Opening a review uses its merge base and head as the diff range. No git-appraise binary is required. |
| GIT-11 | S | Warn when refs drift from remotes. | A yellow alert lists local branches ahead, behind, or diverged from the remote branch of the same name, and remote tags that are new or moved. Each row offers the matching action: rebase a behind or diverged branch, push an ahead branch, or fetch tags. Auto fetch runs `git fetch --all` on a chosen interval and is off until the user turns it on. |

## 6. Component contract

These are the public props. Names are fixed for the embed surface; internals may change.

```ts
interface ReinsProviderProps {
  client: ReinsClient;                 // required, injected
  theme?: 'light' | 'dark' | 'system';
  version?: number;                    // bump to refetch every view from the client
  initialFocus?: NavigationTarget;
  onNavigate?: (target: NavigationTarget) => void;
}

type NavigationTarget =
  | { type: 'symbol'; id: string; file?: string; line?: number }
  | { type: 'surface'; id: string }
  | { type: 'diff'; range: DiffRange; symbolId?: string }
  | { type: 'node'; id: string };
```

Each view accepts the shared context plus view-specific props:

| Component | Required props | Optional props |
| --- | --- | --- |
| `GraphView` | `root: { symbolId: string } \| { query: string }` | `direction`, `depth`, `filters`, `onExpand` |
| `SurfaceExplorer` | none | `filters`, `onSelect`, `groupBy` |
| `DiffViewer` | `range: DiffRange` | `file`, `layout: 'split' \| 'stacked'`, `onPromote` |
| `KnowledgeStudio` | ReinsProvider | `height` |
| `ReviewWorkspace` | `range: DiffRange` | `initialSelection`, `onNavigate` |
| `RepoStatus` | none | `compact` |

Rules that apply to all components:

- No `node:*` imports, no Tauri import, no direct `fetch` without an injected transport.
- Mantine is the component and theme layer. The host imports the Mantine stylesheet and the Reins token stylesheet; class names are prefixed `reins-`.
- Loading, empty, error, and truncated states are implemented, not left to the host.
- Keyboard access for every action; visible focus; ARIA labels on icon-only controls.
- A component must render with an empty repository (demo mode) for documentation and tests.

## 7. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Offline | Index, graph, search, diff, knowledge read, and knowledge check work with no network. |
| Determinism | Same repo, graph revision, options produce the same JSON for graph, surfaces, diff, and check results. |
| Privacy | No telemetry, no crash upload, no code leaves the machine unless the user configures an LLM provider. |
| Startup | Warm start to usable status in 1.5 s or less on a 100k LOC repository with a built graph. |
| Graph query | Depth 2 callers under 250 ms p95; depth 5 under 1.2 s p95, on a 200k node graph. |
| Semantic diff | 1,000-line file under 300 ms p95; 5,000-line file under 1 s p95; files over 1 MB or 20k nodes degrade to line diff with a flag. |
| Knowledge | 2,000 nodes indexed under 1.5 s cold; query p95 under 50 ms; `check` under 1 s. |
| Memory | Idle desktop app under 350 MB RSS; main-process heap under 200 MB. |
| Accessibility | Keyboard reachable, visible focus, AA contrast, no color-only encoding for diff operations. |
| Portability | macOS first; Windows and Linux build in Phase 6. Repository-relative POSIX paths everywhere. |
| Recovery | A corrupt cache is deleted and rebuilt; a corrupt config produces a readable error and no write. |

Budgets are targets with a 20% regression window. Measure on a fixed fixture corpus; report the machine and commit with every result.

## 8. Success criteria

A release is successful when these are true for real repositories, not fixtures alone.

1. A developer opens a 100k LOC TypeScript repository, searches a route, and sees the full handler flow in under 10 seconds from launch.
2. A reviewer sees "moved and renamed, body unchanged" for a real refactor, with no false add/delete pair.
3. An agent session with Reins tools reads fewer files than the same task without them, measured by tool calls and tokens on the evaluation tasks in `06`.
4. Every accepted decision node can be reached from at least one symbol or surface.
5. The same `GraphView` and `DiffViewer` render in the desktop app and in the host example app without code changes.
6. `pnpm check` is green from a clean clone on macOS and Linux.

## 9. Out of scope for the first public release

- Editing code inside Reins.
- Pull request hosting, authentication, or team sync.
- Multiplayer canvas.
- Full type-aware cross-program analysis.
- Languages without a Trail parser.
- Automatic rewriting of code from diff suggestions.
- Any feature that requires uploading repository content.

## 10. Glossary

| Term | Meaning |
| --- | --- |
| Graft | Trail's on-disk code graph. Reins reads it through the Trail adapter and never edits it. |
| Symbol | A named definition in the graph, identified by Trail's node ID such as `src/math.ts#add`. |
| Surface | A user-reachable entry point mapped onto a symbol. |
| Flow | The subgraph reachable from a surface or symbol. |
| Slice | A bounded graph result with nodes, edges, depth, and a truncation flag. |
| Semantic operation | One structural change between two revisions: move, rename, extract, inline, reformat, modify, add, remove, reorder. |
| Knowledge node | A committed markdown file under `.reins/knowledge/`, describing intent, a decision, a constraint, a procedure, or a question. Its directory is its component. |
| Harness pack | A deterministic, token-bounded context bundle for an agent session. |
| Client | The typed interface every UI component uses to reach the core. |
| Host | Any application embedding Reins components: desktop shell, tldraw, web app, webview. |

## 11. MVP checklist

The MVP is the union of Phase 1 to Phase 5. Each line maps to a requirement ID.

- [ ] Open a repository and report graph status (REPO-1, REPO-2, REPO-3).
- [ ] Search symbols and show callers, callees, and blast radius (GRAPH-1, GRAPH-2, GRAPH-3).
- [ ] Discover Express and Next.js surfaces, linked to nodes (SURF-1, SURF-2, SURF-3).
- [ ] Trace from a route (SURF-5).
- [ ] Structural diff for a file and a commit range, with moves and renames (DIFF-1 to DIFF-9).
- [ ] Knowledge nodes with typed links and backlinks (KNOW-1 to KNOW-5).
- [ ] Simple knowledge board (KNOW-6).
- [ ] Every major view embeddable (EMBED-1 to EMBED-4).
- [ ] Desktop workspace containing graph, diff, and knowledge (REV-1).
- [ ] CLI JSON and MCP graph tools (CLI-1, MCP-1).
