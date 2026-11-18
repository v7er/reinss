# 03. Data contracts

Every artifact Reins reads or writes has a versioned shape defined here. The core owns the schemas; transports, caches, and tests import them. If a shape changes, this document changes in the same commit.

Conventions:

- JSON uses camelCase. File formats that are not JSON (markdown frontmatter, YAML) use snake_case keys to match common knowledge tooling.
- Timestamps are ISO 8601 UTC strings with seconds precision.
- Paths are repository-relative POSIX paths with no leading `./` and no absolute form, except `RepoStatus.repo.root`, which is local-only and omitted when paths are redacted.
- Line numbers are 1-based and inclusive.
- Arrays that are presented to users have a documented sort order. Unknown fields are ignored by readers and preserved only where stated.
- Every cache and result artifact carries a version. The API carries `contractVersion`.

## 1. Versioning

| Surface | Field | Current | Rule |
| --- | --- | --- | --- |
| Core API | `contractVersion` in every response envelope | 1 | New optional fields are allowed in a minor. Removing or renaming a field requires a bump and a transport update in the same change. |
| Config | `version` | 1 | Older configs migrate in memory. Unknown keys are preserved on write. |
| Cache | `schemaVersion` | 1 | Mismatch discards the file. No migration. |
| Knowledge note | frontmatter fields | 1 | New optional fields are allowed. New required fields need a migration command and a docs update. |
| Trail input | adapter version | 1 | The adapter declares the Trail versions it was tested against. Unknown JSON shape fails with `TRAIL_FORMAT_UNSUPPORTED`. |

The Trail CLI's JSON is an external contract. Reins validates it with zod, keeps recorded fixtures per Trail version under `test/fixtures/trail/<version>/`, and never trusts an unchecked field.

## 2. Config

Path: `<repo>/.reins/config.json`. Created by `reins init`. Missing config means defaults; Reins does not write a config during a read-only command.

```json
{
  "version": 1,
  "graftDir": "graft",
  "knowledgeDir": ".reins/knowledge",
  "surfaces": {
    "detectors": ["express", "hono", "commander", "next-app", "react-router"],
    "ignore": ["**/generated/**", "**/*.test.ts"]
  },
  "ignore": ["**/node_modules/**", "**/dist/**"],
  "secretPatterns": [".env*", "*.pem", "*.key", "id_rsa", "id_ed25519"],
  "diff": {
    "maxFileBytes": 1048576,
    "maxNodesPerFile": 20000
  },
  "check": {
    "verifyCodeLinks": true,
    "folderMismatch": "warning"
  },
  "llm": {
    "enabled": false,
    "provider": null,
    "model": null
  },
  "ui": {
    "theme": "system"
  }
}
```

Validation rules:

- `version` must be `1`.
- `graftDir` and `knowledgeDir` are repository-relative, must not contain `..`, and must not escape the root after realpath.
- `detectors` must be known IDs. Unknown IDs are a config error with the list of valid IDs.
- `llm.enabled: true` requires `provider` and `model`. The API key is never in this file.
- `ui` is local preference and may be ignored by the CLI.
- `ignore` patterns are gitignore-style, evaluated by the scanner, not by Trail.

## 3. Trail adapter

### 3.1 Detection and versions

- Minimum supported Trail: `0.28.0`, the first version verified to expose `status`, `callers`, `ask`, `skeleton`, and `build --check` with `--json`.
- Tested range is recorded in `packages/node/src/trail/compat.ts`. Currently tested: `0.28.x`, with `0.30.x` added as soon as its JSON is recorded.
- A newer major (1.x) is `TRAIL_VERSION_UNSUPPORTED` until a fixture and adapter update land.
- Missing binary: `TRAIL_MISSING`. The UI offers a link to the Trail install docs; Reins never installs it.

### 3.2 Commands used

| Purpose | Command | Timeout |
| --- | --- | --- |
| Version | `trail --version` | 5 s |
| Status | `trail status <root> --json` | 10 s |
| Build | `trail build <root>` | 120 s |
| Stale check | `trail build <root> --check --json` | 30 s |
| Callers | `trail callers <symbol> <root> --json [--direction in\|out] [--depth n] [--in path] [--no-refresh]` | 15 s |
| Search | `trail ask <query> <root> --json --limit n [--in path] [--no-refresh]` | 15 s |
| File symbols | `trail skeleton <file> <root> --json [--no-refresh]` | 10 s |

No human-readable output is parsed. If a needed value is not in the JSON, the operation is not implemented rather than scraped from text.

### 3.3 Adapter result types

The adapter maps Trail's JSON into these shapes before normalization. They are internal to `@reins/node` but documented so tests and fixtures agree.

```ts
interface TrailStatus {
  nodes: number;
  inSync: boolean;
}

interface TrailSymbol {
  id: string;
  name: string;
  kind: string;
  path: string;
  span: string;                 // "L2-L4"
}

interface TrailHit extends TrailSymbol {
  relation: string;             // "calls" today
  depth: number;
}

interface TrailMatch {
  symbol: TrailSymbol;
  hits: TrailHit[];
}

interface TrailCallersResult {
  query: string;
  matches: TrailMatch[];
}

interface TrailAskHit {
  kind: string;                 // "symbol" or "file"
  title: string;
  pointer: string;              // "src/a.ts:L2-L4" or "src/a.ts"
  snippet: string;
  score: number;
}

interface TrailAskResult {
  query: string;
  hits: TrailAskHit[];
}

interface TrailSkeletonResult {
  file: string;
  entries: Array<{ name: string; kind: string; span: string; signature: string }>;
}
```

### 3.4 Observed Trail JSON

Recorded from Trail 0.28.0. These are inputs, not Reins contracts; the adapter maps them.

`trail callers add . --json`:

```json
{
  "query": "add",
  "matches": [
    {
      "symbol": {
        "id": "src/math.ts#add",
        "name": "add",
        "kind": "function",
        "path": "src/math.ts",
        "span": "L1-L1"
      },
      "hits": [
        {
          "id": "src/total.ts#total",
          "relation": "calls",
          "depth": 1,
          "name": "total",
          "kind": "function",
          "path": "src/total.ts",
          "span": "L2-L2"
        }
      ]
    }
  ],
  "saved": { "files": 2, "baselineChars": 136 }
}
```

`trail ask total . --json`:

```json
{
  "query": "total",
  "mode": "lexical",
  "hits": [
    {
      "kind": "symbol",
      "title": "total · function",
      "pointer": "src/total.ts:L2-L2",
      "snippet": "function total()",
      "score": 1.5
    }
  ],
  "coverage": 1,
  "coverageStrong": 1
}
```

`trail skeleton src/math.ts . --json`:

```json
{
  "file": "src/math.ts",
  "entries": [
    {
      "name": "add",
      "kind": "function",
      "span": "L1-L1",
      "signature": "function add(a: number, b: number)"
    }
  ]
}
```

`trail status . --json`:

```json
{
  "codeMap": { "nodes": 4, "inSync": true },
  "learnings": null,
  "workspace": null,
  "week": { "savedTokens": 0 }
}
```

Known gaps, handled explicitly:

- Trail returns spans (`L2-L4`), not columns. Reins uses lines only; no column-dependent feature ships.
- Trail call results do not include the call-site line. `GraphEdge.line` is `null` until a call-site extraction exists. Do not invent one.
- A symbol query can match multiple symbols. The adapter returns all matches; the API collapses them to one root only when `strict` is set, and otherwise returns `AMBIGUOUS_SYMBOL` with candidates.
- Trail can refresh during a query. The adapter checks `status` once per request batch and then passes `--no-refresh` so one response reflects one revision.

### 3.5 Normalization

```ts
interface TrailSpan {
  startLine: number;
  endLine: number;
}

type SymbolKind =
  | 'module'
  | 'function'
  | 'method'
  | 'class'
  | 'component'
  | 'endpoint'
  | 'command'
  | 'handler'
  | 'constant'
  | 'type'
  | 'file'
  | 'unknown';

interface GraphNode {
  id: string;                 // Trail node ID, e.g. "src/math.ts#add"
  name: string;
  kind: SymbolKind;
  path: string;
  startLine: number;
  endLine: number;
  signature?: string | null;
  language?: string | null;
  depth: number;              // 0 for the root
  external: boolean;          // true when the target has no local definition
}

interface GraphEdge {
  source: string;
  target: string;
  relation: 'calls' | 'references';
  depth: number;              // depth of the target in the traversal
  line: number | null;        // null: Trail does not expose call-site lines
}

interface GraphSlice {
  contractVersion: 1;
  root: GraphNode | null;
  direction: 'in' | 'out' | 'both';
  requestedDepth: number;
  effectiveDepth: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  truncatedBy: 'nodes' | 'time' | null;
  revision: GraphRevision;
}

interface GraphRevision {
  fingerprint: string;
  trailVersion: string;
  gitHead: string | null;
  inSync: boolean;
  checkedAt: string;
}
```

Mapping rules:

- `span` is parsed with `^L(\d+)(?:-L(\d+))?$`. A value that does not match is a format error, not a guess.
- `relation` values other than `calls` map to `references`. The raw value is kept in a log, not in the public edge, until the UI needs it.
- `hits` become nodes and edges from the match symbol to each hit. With `direction: 'both'`, two calls are made and the slices are merged by node ID; an edge present in either direction is kept, and conflicting depths keep the smaller.
- `depth` from Trail is preserved. Reins does not recompute depth from edges.
- Sorting: nodes by `(depth, path, startLine, id)`, edges by `(source, target, relation)`.
- The root node is included in `nodes`.

Search mapping:

```ts
interface SymbolHit {
  id: string | null;          // null for a file-level hit
  name: string;
  kind: SymbolKind | 'file';
  path: string;
  startLine: number | null;
  endLine: number | null;
  snippet: string;
  score: number;
}
```

- `pointer` `path:L2-L4` maps to a symbol hit; a bare path maps to a file hit.
- `title` is not used for the name. The name comes from the pointer path basename for file hits and from the last segment before `·` for symbol hits, then is corrected by `skeleton` if it disagrees.
- `score` is passed through for sorting. Ties sort by path, then line.

### 3.6 Request types

These are the inputs to `ReinsApi`. Every transport validates them with the same schemas.

```ts
interface SearchOptions {
  limit?: number;              // default 10, max 50
  pathPrefix?: string;
}

interface RefreshOptions {
  force?: boolean;             // rebuild even when the graph reports in sync
}

interface GraphRequest {
  root: { symbolId: string } | { query: string } | { surfaceId: string };
  direction?: 'in' | 'out' | 'both';   // default 'in'
  depth?: number;                      // default 1, clamped 1..5
  maxNodes?: number;                   // default 500, clamped 1..2000
  pathPrefix?: string;
}

interface SurfaceFilter {
  kind?: SurfaceKind;
  framework?: string;
  pathPrefix?: string;
  query?: string;
  confidence?: 'exact' | 'inferred';
}

interface FlowRequest {
  target: string;                      // surface id, route, or symbol id
  direction?: 'in' | 'out' | 'both';   // default 'out'
  depth?: number;                      // default 3, clamped 1..5
  maxNodes?: number;                   // default 500, clamped 1..2000
}

interface NoteFilter {
  query?: string;
  type?: NoteType;
  status?: NoteStatus;
  tag?: string;
  limit?: number;                      // default 20, max 100
}

interface CheckRequest {
  scope?: 'knowledge' | 'knowledge+code' | 'diff';  // default 'knowledge'
  strict?: boolean;                    // default false
}
```

## 4. Repository status and API envelope

```ts
type GraphState =
  | 'ready'
  | 'stale'
  | 'missing-trail'
  | 'unsupported-trail'
  | 'missing-graft'
  | 'error';

interface RepoStatus {
  contractVersion: 1;
  repo: { name: string; root: string | null };  // null when redactPaths is on
  git: { head: string | null; branch: string | null; dirty: boolean };
  trail: { version: string | null; minVersion: string; graftDir: string };
  graph: {
    state: GraphState;
    inSync: boolean;
    nodes: number | null;
    checkedAt: string;
    fingerprint: string | null;
    message?: string;
  };
  knowledge: { notes: number; proposed: number; errors: number };
  surfaces: { count: number; stale: boolean };
}

type ApiEnvelope<T> =
  | { contractVersion: 1; ok: true; data: T }
  | { contractVersion: 1; ok: false; error: ReinsError };
```

The CLI prints the envelope with `--json`; the MCP server returns the payload without the envelope and maps errors to tool errors. Tauri returns the envelope. The envelope shape never varies by method.

## 5. Surfaces

### 5.1 Shape

```ts
type SurfaceKind = 'http' | 'cli' | 'page' | 'screen' | 'export';

interface Surface {
  id: string;
  kind: SurfaceKind;
  framework: string;
  label: string;
  route: string | null;
  method: string | null;
  symbolId: string | null;
  symbolName: string | null;
  file: string;
  line: number;
  confidence: 'exact' | 'inferred';
  evidence: 'ast' | 'openapi' | 'config';
  detector: string;
  detectorVersion: number;
  metadata: Record<string, string | number | boolean>;
}

interface SurfacePage {
  contractVersion: 1;
  items: Surface[];
  total: number;
  offset: number;
  limit: number;
  truncated: boolean;
  stale: boolean;
}
```

`symbolId` rules:

- A linked surface has a real Trail node ID and `confidence: 'exact'` only when the handler symbol was resolved from imports or the same file.
- When the handler is a function expression with no name, link to the enclosing named symbol and mark `confidence: 'inferred'`.
- When no symbol can be linked, `symbolId` is `null` and `metadata.linkReason` explains why (`anonymous-handler`, `dynamic-route-table`, `external-module`).
- `symbolName` is filled when `symbolId` is null but a name is known. Never fabricate an ID.

### 5.2 IDs

IDs are deterministic and readable. They are stored in knowledge notes, so a change is breaking.

| Kind | Format | Example |
| --- | --- | --- |
| HTTP | `http:<framework>:<METHOD>:<normalized-route>` | `http:express:GET:/api/users/:id` |
| CLI | `cli:<framework>:<command-path>` | `cli:commander:users:list` |
| Page | `page:<framework>:<normalized-route>` | `page:next-app:/cart` |
| Screen | `screen:<framework>:<screen-name>` | `screen:expo:Checkout` |
| Export | `export:<package-name>:<export-name>` | `export:@acme/api:createClient` |

Normalization:

- Framework IDs are lowercase, no spaces: `express`, `hono`, `commander`, `next-app`, `react-router`, `expo`.
- Methods are uppercase.
- Routes start with `/`, collapse duplicate slashes, and drop the trailing slash except for `/`.
- Next.js route groups `(shop)` are removed for page IDs, so moving a page between groups does not change identity. Dynamic segments keep their framework syntax (`[id]`, `:id`).
- CLI commands join segments with `:` after the framework.
- If two surfaces from different files produce the same ID, the detector appends `@<file>` to both and the check report warns. Silent overwrites are forbidden.

### 5.3 Detector contract

```ts
type Language = 'typescript' | 'tsx' | 'javascript' | 'jsx' | 'python' | 'go' | 'rust' | 'vue' | 'unknown';

interface SurfaceDetector {
  id: string;
  version: number;
  frameworks: string[];
  languages: Language[];
  filePatterns: string[];              // cheap prefilter before parsing
  detect(ctx: DetectorContext): DetectedSurface[];
}

interface DetectorContext {
  file: SourceFile;                    // path, text, language
  tree: ParsedTree;                    // injected ParserPort result
  symbols: SymbolHint[];               // names and spans from trail skeleton for this file
}

type DetectedSurface = Omit<Surface, 'id' | 'detector' | 'detectorVersion' | 'confidence' | 'evidence'> & {
  confidence?: 'exact' | 'inferred';
  evidence?: 'ast' | 'openapi' | 'config';
};
```

Rules:

- Detectors run only on files matching `filePatterns` and a framework marker from the config. A Next.js repository does not run the Commander detector on every file.
- A detector must be deterministic and must not read files itself. It gets one file and its tree.
- `symbols` is the resolution hint list, not a guarantee. A detector may use AST structure to resolve a local function name against the hint list.
- A detector that throws is isolated: the scan records `detector: <id>, error` in diagnostics and continues. One broken detector does not fail the scan.
- Adding a detector requires: module, registry entry, fixture repository under `test/fixtures/surfaces/<name>/`, golden surfaces JSON, and a row in the supported table.

Initial supported matrix:

| Phase | Detector | Languages | Surfaces |
| --- | --- | --- | --- |
| 2 | `express` | TS, JS | `app.get`, `app.post`, `router.*`, chained routes |
| 2 | `hono` | TS, JS | `app.get`, `app.post`, `.route()` groups |
| 2 | `commander` | TS, JS | `.command()` and `.action()` |
| 2 | `next-app` | TSX, JSX | `app/**/page.tsx`, `app/**/route.ts` exports |
| 2 | `react-router` | TSX, JSX | `createBrowserRouter` route objects, `<Route path>` |
| 6 | `fastapi` | Python | `@app.get`, `@router.post` |
| 6 | `expo` | TSX | screen files in a router directory |

## 6. Semantic diff

### 6.1 Range and request

```ts
type DiffRange =
  | { mode: 'working' }
  | { mode: 'staged' }
  | { mode: 'range'; base: string; head: string }
  | { mode: 'base'; base?: string };   // merge-base of HEAD and base, default main

interface DiffRequest {
  range: DiffRange;
  files?: string[];                    // optional limit, repository-relative
  includeTrivia?: boolean;             // default false
  maxOperationsPerFile?: number;       // default 500
}
```

Resolution:

- `working`: index to working tree, including untracked files.
- `staged`: `HEAD` to index.
- `range`: `base` to `head`, both resolved to commit SHAs.
- `base`: `git merge-base <base> HEAD` to working tree.
- The response reports the resolved SHAs. A range that cannot resolve fails with `GIT_RANGE_INVALID`.

### 6.2 Result

```ts
type ChangeKind =
  | 'added'
  | 'removed'
  | 'modified'
  | 'moved'
  | 'renamed'
  | 'reformatted'
  | 'extracted'
  | 'inlined'
  | 'reordered';

interface SourceSpan {
  path: string;
  startLine: number;
  endLine: number;
  name?: string;
}

interface SemanticChange {
  id: string;                          // stable within a result
  kind: ChangeKind;
  confidence: 'high' | 'medium' | 'low';
  symbol: {
    id: string | null;                 // new-side Trail-style ID when derivable
    name: string;
    kind: SymbolKind;
  };
  from: SourceSpan | null;
  to: SourceSpan | null;
  flags: {
    moved: boolean;
    renamed: boolean;
    reformatOnly: boolean;
  };
  detail?: {
    extractedInto?: string;
    inlinedFrom?: string;
    tokenDelta?: number;
    renamedFrom?: string;
    renamedTo?: string;
    reason?: string;                   // why low confidence, shown in the UI
  };
}

interface FileDiff {
  path: string;
  oldPath: string | null;
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';
  language: Language;
  degraded: boolean;
  degradedReason?: 'parse-error' | 'too-large' | 'unsupported-language' | 'worker-failed';
  changes: SemanticChange[];
  stats: Record<ChangeKind, number>;
}

interface SemanticDiff {
  contractVersion: 1;
  range: DiffRange;
  resolved: {
    mode: 'working' | 'staged' | 'range' | 'base';
    baseCommit: string | null;
    headCommit: string | null;
    mergeBase: string | null;
  };
  files: FileDiff[];
  truncated: boolean;
  truncatedBy: 'operations' | 'files' | null;
}
```

### 6.3 Operation semantics

| Kind | Meaning | Required evidence |
| --- | --- | --- |
| `added` | Definition exists only on the new side. | No matched old subtree. |
| `removed` | Definition exists only on the old side. | No matched new subtree. |
| `modified` | Same identity, different tokens. | Matched node, token stream differs. |
| `moved` | Same normalized subtree at a different path or parent position. | Subtree hash equal, location differs. A move that also renames is one `moved` with `flags.renamed`. |
| `renamed` | Same normalized subtree, same location, different name. | Subtree hash equal, name differs, parent and file equal. |
| `reformatted` | Token stream equal, trivia differs. | Comment, whitespace, or line break differences only. |
| `extracted` | Old body content now lives in a new definition called from the old site. | New subtree token overlap ≥ 80% with old body and a new call edge from the old site, or the old body is left as a thin wrapper. Confidence reflects the overlap and call evidence. |
| `inlined` | A removed definition's body appears inside its former caller. | Reverse of extracted, same evidence rule. |
| `reordered` | Same definitions, same parent, index order changed. | All siblings matched, order differs, no content change. |

Rules:

- One logical change produces one operation. A move plus rename is `moved` with `flags.renamed: true`, not two rows.
- `reformatted` wins over `modified` when the normalized token stream is equal. Comments are trivia for this test unless `includeTrivia` is true.
- `extracted` and `inlined` are separate operations only when the old or new site also changed. A pure move into a new function with no call-site change is `moved` plus `added`, with a low-confidence note. Do not overclaim.
- `confidence: 'high'` requires exact subtree hash or exact token equality. `'medium'` requires a sibling match with equal kind and ≥ 70% child overlap. `'low'` is a structural guess and must include a reason.
- Unparseable or oversized files produce a `degraded: true` file with zero semantic operations. The UI shows the line diff and the reason.
- Sorting: files by path, changes by `(from?.startLine ?? to?.startLine ?? 0, kind, id)`. `stats` counts every operation once.

### 6.4 Stable IDs

`SemanticChange.id` is a short hash of `(path, kind, fromPath, fromStart, toPath, toStart, symbol.name)`, truncated to 12 hex characters. It is stable across runs for the same inputs and is not stable across unrelated edits, which is intended.

### 6.5 Matching order

The matcher runs in this order and stops at the first classification that applies:

1. Match identical subtree hashes across both sides, ignoring trivia.
2. Match same-parent, same-kind, same-name candidates.
3. Match same-parent, same-kind candidates by child-structure similarity.
4. For remaining additions and removals, test extraction and inlining.
5. For remaining unmatched nodes, emit `added` and `removed`.
6. If all matched siblings changed only order, downgrade to `reordered`.

No step may mutate the tree. The matcher is a pure function from two parsed trees to operations.

## 7. Knowledge notes

### 7.1 Location and identity

```text
.reins/knowledge/
  specs/<id>.md
  decisions/<id>.md
  constraints/<id>.md
  howto/<id>.md
  questions/<id>.md
  inbox/<id>.md
```

- `id` is the filename stem: lowercase letters, digits, and hyphens, 2 to 64 characters, starting with a letter or digit. It is immutable in practice. Renaming a note requires updating links; `reins check` reports broken ones.
- `type` is one of `spec`, `decision`, `constraint`, `howto`, `question`.
- The folder is derived from `type`, except for `inbox/`, which holds proposals of any type. A mismatch is a warning, not an error, because the note is still valid.
- No `index.md`, no layer configuration, no required ordering. Type plus links do the job.

```ts
type NoteType = 'spec' | 'decision' | 'constraint' | 'howto' | 'question';
type NoteStatus = 'proposed' | 'accepted' | 'superseded' | 'deprecated' | 'rejected';
```

### 7.2 Frontmatter

```yaml
---
title: Refunds write to the ledger first
type: decision
status: accepted
created: 2026-11-18
updated: 2026-11-18
owner: tuevo
tags: [billing, refunds]
links:
  - rel: implements
    note: spec-refunds
  - rel: constrains
    symbol: src/billing/refund.ts#RefundService.refund
  - rel: exposes
    surface: http:express:POST:/refunds
commits: [1a2b3c4]
---
```

Fields:

| Field | Required | Rules |
| --- | --- | --- |
| `title` | yes | 1 to 120 characters, plain text. |
| `type` | yes | One of the five types. |
| `status` | yes | `proposed`, `accepted`, `superseded`, `deprecated`, `rejected`. Proposals start as `proposed`. |
| `created` | yes | ISO date. |
| `updated` | yes | ISO date, must not precede `created`. Maintained by the author or by the accept action, never silently rewritten. |
| `owner` | no | Free text, not an email requirement. |
| `tags` | no | Lowercase strings, max 12, each max 32 characters. |
| `links` | no | Typed links, see 7.3. |
| `commits` | no | Full or 7-character SHAs. |
| `supersedes` | no | Note id. |
| `supersededBy` | no | Note id. |
| `rule` | constraints only | Machine-checkable rule, see 7.7. |

Unknown top-level keys are preserved on write and ignored by readers. Unknown `type` or `status` is an error.

### 7.3 Links

A link has a `rel` and exactly one target field:

```ts
type NoteLink =
  | { rel: LinkRel; note: string }
  | { rel: LinkRel; symbol: string }
  | { rel: LinkRel; surface: string }
  | { rel: LinkRel; commit: string }
  | { rel: LinkRel; file: string };

type LinkRel =
  | 'implements'
  | 'refines'
  | 'constrains'
  | 'explains'
  | 'depends_on'
  | 'exposes'
  | 'affects'
  | 'relates_to';
```

Rules:

- `rel` is closed. Adding one is a schema change with a docs update.
- `symbol` must be a Trail-style ID (`path#name`). It is verified against the graph when `check.verifyCodeLinks` is on.
- `surface` must match an existing surface ID.
- `file` is verified to exist, but not to still contain the relevant code.
- `commit` is resolved with `git cat-file -e <sha>^{commit}`. An unknown commit is a warning, because history may be shallow.
- Body `[[note-id]]` mentions are parsed as untyped note mentions. They create backlinks but do not replace typed links. A mention of an unknown note is a warning.
- Duplicate links with the same `rel` and target are an error.

### 7.4 Body

Free markdown. Recommended sections for decisions: `Decided`, `Context`, `Ruled out`, `Consequences`, `Watch out`. These are guidance, not validation. Constraint notes must include a `Rule` section that restates the rule in prose.

### 7.5 Status lifecycle

```text
proposed ──accept──> accepted ──supersede──> superseded
    │                   │
    └──reject──> rejected└──deprecate──> deprecated
```

- `proposed` notes live in `inbox/`. The only writer is `proposeNote`.
- Accepting is an explicit action: move the file to its type folder, set `status: accepted`, update `updated`, and leave a Git diff the human reviews. Reins never commits.
- Accepted notes are the only ones included in harness packs and constraint checks.
- Deleting an accepted note requires no special handling; links to it become `LINK_BROKEN`.

### 7.6 Index and search

```ts
interface NoteSummary {
  id: string;
  title: string;
  type: NoteType;
  status: NoteStatus;
  tags: string[];
  updated: string;
  path: string;
  linkCount: number;
  backlinkCount: number;
}

interface KnowledgeNote extends NoteSummary {
  body: string;
  links: NoteLink[];
  commits: string[];
  mentions: string[];
  frontmatter: Record<string, unknown>;
}
```

Search ranks in this order, all deterministic:

1. Exact title match.
2. Title contains the query, case-insensitive.
3. Tag exact match.
4. Body contains the query.
5. Linked symbol name contains the query.

Ties sort by `updated` descending, then `id`. No fuzzy scoring library in v1. Index 1,000 notes with a linear scan.

### 7.7 Constraint rules

A constraint note may carry a rule. Phase 4 supports exactly two kinds.

```yaml
rule:
  kind: forbidden-import
  from: "src/billing/**"
  to: "src/gateway/**"
```

```yaml
rule:
  kind: forbidden-call
  caller: "src/billing/**"
  callee: "src/gateway/**"
```

Rules:

- Globs use the same matcher as file discovery. `**` crosses directories, `*` does not.
- `forbidden-import` is evaluated against added or changed import statements in the diff.
- `forbidden-call` is evaluated against calls in changed symbols, using Trail edges for the changed file.
- A rule that cannot be evaluated (unsupported file type, graph missing) returns `not-applicable` with a reason. It never silently passes.
- Adding a third rule kind requires a new evaluator, tests, and a docs update. Do not add a general expression language.

### 7.8 Proposal

```ts
interface NoteProposal {
  type: NoteType;
  title: string;
  body: string;
  tags?: string[];
  links?: NoteLink[];
  source?: {
    kind: 'review-comment' | 'agent' | 'manual';
    file?: string;
    line?: number;
    diffRange?: DiffRange;
    agent?: string;
  };
}

interface NoteProposalResult {
  id: string;
  path: string;
  status: 'proposed';
  diff: string;              // unified diff of the new file, for review
  warnings: string[];
}
```

Rules:

- The id is derived from the title: lowercase, ASCII, hyphens, max 64. On collision, append `-2`, `-3`, and so on.
- The target path is always under `knowledge/inbox/`. Any `..`, absolute path, or existing file produces `PATH_ESCAPE` or `NOTE_EXISTS`.
- The writer uses a temporary file and rename. A failed write leaves no partial note.
- `source` is provenance metadata and is stored under `provenance` in frontmatter.

## 8. Check report

```ts
type CheckSeverity = 'error' | 'warning' | 'info';

interface CheckItem {
  code: CheckCode;
  severity: CheckSeverity;
  message: string;
  noteId?: string;
  path?: string;
  line?: number;
  fix?: string;
}

interface CheckReport {
  contractVersion: 1;
  ok: boolean;                       // true when no error-severity items
  scope: 'knowledge' | 'knowledge+code' | 'diff';
  items: CheckItem[];
  summary: Record<CheckSeverity, number>;
  revision: GraphRevision & { knowledgeHash: string };
}

type CheckCode =
  | 'NOTE_INVALID'
  | 'NOTE_DUPLICATE_ID'
  | 'NOTE_FOLDER_MISMATCH'
  | 'NOTE_STATUS_INVALID'
  | 'LINK_BROKEN'
  | 'LINK_DUPLICATE'
  | 'LINK_TARGET_UNKNOWN'
  | 'SYMBOL_UNKNOWN'
  | 'SYMBOL_MOVED'
  | 'SURFACE_UNKNOWN'
  | 'CONSTRAINT_VIOLATED'
  | 'CONSTRAINT_SKIPPED'
  | 'CONFIG_INVALID';
```

- `SYMBOL_MOVED` means the symbol existed but its start line no longer matches the note's recorded link. It is a warning with the current span in `fix`.
- `ok` is false only for errors. Warnings are shown but do not fail `reins check` unless `--strict` is passed.
- Sorting: severity (error, warning, info), then path, then line, then code.

## 9. Harness pack

```ts
interface PackRequest {
  intent: string;                   // what the agent is about to do
  paths?: string[];
  symbols?: string[];
  maxTokens?: number;               // default 4000, hard cap 12000
  includeSurfaces?: boolean;        // default true
}

interface HarnessPack {
  contractVersion: 1;
  markdown: string;
  tokenEstimate: number;
  truncated: boolean;
  sections: Array<{ name: string; bytes: number }>;
  revision: GraphRevision & { knowledgeHash: string };
}
```

Pack rules:

- Sections, in order: repository and revision, intent, relevant surfaces, relevant symbols with file:line and signature, constraints, accepted decisions, open questions, commands, excluded material.
- Selection uses Trail `ask` with the intent, filtered by provided paths and symbols. No LLM call.
- `tokenEstimate` is `ceil(markdown.length / 4)`. It is an estimate, labeled as one.
- Deterministic: same inputs and revision produce the same markdown. No timestamps inside the markdown.
- Absolute paths never appear. Secrets are excluded by the same patterns as indexing.
- Truncation drops sections in reverse order of importance and records what was dropped in a final `Truncated` section.

## 10. Errors

```ts
interface ReinsError {
  code: ErrorCode;
  message: string;                  // human-readable, no stack
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

`ErrorCode` is the union of the codes in the table below. Adding a code is a contract change: update the table, the CLI exit mapping, and the MCP error test.

| Code | Meaning | Retryable | Transport mapping |
| --- | --- | --- | --- |
| `REPO_NOT_FOUND` | Folder missing, not a directory, or unreadable. | no | CLI exit 1, MCP error |
| `REPO_NOT_OPEN` | No repository session is open. | no | CLI exit 1, Tauri error |
| `INVALID_INPUT` | Params failed schema validation; `details.issues` holds field paths. | no | CLI exit 1 |
| `EDITOR_UNAVAILABLE` | No supported editor or URL scheme on this platform. | no | Tauri error |
| `PATH_ESCAPE` | A path resolved outside the repository root. | no | CLI exit 1, MCP error |
| `CONFIG_INVALID` | Config schema or unknown detector. | no | CLI exit 1 |
| `TRAIL_MISSING` | `trail` binary not found. | no | CLI exit 2 |
| `TRAIL_VERSION_UNSUPPORTED` | Trail outside the tested range. | no | CLI exit 2 |
| `TRAIL_MISSING_GRAFT` | No `graft/` index and the user has not built one. | no | CLI exit 2 |
| `TRAIL_FAILED` | Trail exited non-zero; `details.stderr` holds the tail. | yes | CLI exit 2 |
| `TRAIL_FORMAT_UNSUPPORTED` | JSON did not match the adapter schema. | no | CLI exit 2 |
| `TRAIL_TIMEOUT` | Trail exceeded its timeout. | yes | CLI exit 2 |
| `TRAIL_OUTPUT_LIMIT` | Trail produced more than the output cap. | no | CLI exit 3 |
| `GIT_MISSING` | `git` binary not found. | no | CLI exit 2 |
| `SYMBOL_NOT_FOUND` | Query matched no symbol. | no | CLI exit 1, MCP error |
| `AMBIGUOUS_SYMBOL` | Multiple roots and no strict choice. | no | CLI exit 1 with candidates |
| `SURFACE_NOT_FOUND` | Surface id unknown. | no | CLI exit 1 |
| `GRAPH_TRUNCATED` | Hard cap reached and the caller refused truncation. | no | CLI exit 3 |
| `GIT_FAILED` | Git command failed. | yes | CLI exit 2 |
| `GIT_RANGE_INVALID` | Range does not resolve. | no | CLI exit 1 |
| `DIFF_PARSE_FAILED` | Grammar failed on both sides. | no | Degraded result if one side parsed |
| `DIFF_WORKER_FAILED` | Utility process died. | yes | CLI exit 4 |
| `DIFF_TOO_LARGE` | File over the configured cap. | no | Degraded result |
| `NOTE_INVALID` | Frontmatter or schema error. | no | CLI exit 1 |
| `NOTE_EXISTS` | Proposal id collision after suffixes. | no | CLI exit 1 |
| `KNOWLEDGE_UNAVAILABLE` | Knowledge directory unreadable. | yes | CLI exit 2 |
| `BUILD_IN_PROGRESS` | A build is already running. | yes | CLI exit 1 |
| `CANCELLED` | Caller aborted. | yes | CLI exit 1 |
| `INTERNAL` | Unexpected failure. | maybe | CLI exit 4 |

Rules:

- Never surface a raw Node error or a stack trace in a user-facing field. Log the stack to `.cache/logs` and attach a correlation id in `details`.
- `details` never includes absolute paths unless `allowAbsolutePaths` was explicitly set.
- Exit code 4 means a Reins bug. It always includes `details.correlationId`.

## 11. Cache artifacts

All cache files live under `.reins/.cache/` and share an envelope:

```ts
interface CacheFile<T> {
  schemaVersion: 1;
  adapterVersion: string;
  createdAt: string;
  fingerprint: string;             // graph fingerprint or content hash
  data: T;
}
```

| File | `data` | Rebuild cost |
| --- | --- | --- |
| `surfaces.json` | `{ surfaces: Surface[], diagnostics: ScanDiagnostic[] }` | Full detector scan |
| `knowledge-index.json` | `{ notes: NoteSummary[], backlinks: Record<string, string[]> }` | Read and parse every note |
| `diff/<key>.json` | `SemanticDiff` | Parse and match both sides |
| `session.json` | `{ recentRepos: string[], lastRepo: string, window?: {...} }` | None, local state |

`session.json` is the only cache with non-derived data. It stores absolute paths because it is local UI state; it is gitignored and never sent anywhere.

`ScanDiagnostic`:

```ts
interface ScanDiagnostic {
  detector: string;
  file: string;
  severity: 'error' | 'warning';
  message: string;
}
```

## 12. Tauri commands and client

The Tauri shell exposes the commands below. `ReinsApi` is defined in [02. Architecture](02-architecture.md#5-one-api-three-transports).

```ts
interface TauriBridge {
  open_repository(path: string): Promise<ApiEnvelope<RepoStatus>>;
  reins_invoke<T>(method: keyof ReinsApi, params?: unknown): Promise<ApiEnvelope<T>>;
  close_repository(): Promise<ApiEnvelope<null>>;
  reveal_in_editor(path: string, line?: number): Promise<void>;
}
```

The Rust side forwards `reins_invoke` to the Node sidecar over newline-delimited JSON. The sidecar is `apps/cli/dist/serve.js` and shares `RepoSession` with the CLI and MCP.

The embeddable client:

```ts
interface ReinsClient {
  readonly kind: 'tauri' | 'ipc' | 'http' | 'memory';
  call<T>(method: keyof ReinsApi, params: unknown): Promise<T>;
  subscribe?(cb: (event: ReinsEvent) => void): () => void;
}

interface ReinsEvent {
  type: 'graph-changed' | 'surfaces-changed' | 'knowledge-changed' | 'progress';
  payload?: unknown;
}
```

Rules:

- `call` validates params with the same core schema as the server side. A renderer bug produces a typed validation error, not a crash.
- `ReinsClient` has no repository path. The session bound to the client knows the repository.
- The default clients are Tauri invoke for the desktop app and an in-memory client for tests and docs. An HTTP client is an interface a host may implement; Reins does not ship a local HTTP server.
- No component calls `call` directly. Each view uses a small hook that owns loading, error, and cancellation state.

## 13. Compatibility checklist for a contract change

Before changing any shape in this document:

- [ ] Update the TypeScript type and zod schema in the same commit.
- [ ] Add or update a contract fixture under `test/fixtures/contracts/`.
- [ ] Update the CLI JSON test and the MCP schema snapshot.
- [ ] Decide whether caches must be discarded. If yes, bump `schemaVersion`.
- [ ] Update this file, including the example if one exists.
- [ ] State the user impact: old notes, old caches, old clients, or old Trail versions.
