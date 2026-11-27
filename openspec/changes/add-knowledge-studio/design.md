# Design: knowledge studio

## 1. Context

Current state, as implemented:

- Notes live in `.reins/knowledge/{specs,decisions,constraints,howto,questions,inbox}/<id>.md`, one flat folder per type (`docs/03-data-contracts.md` section 7).
- Search is a linear scan with a fixed rank; 1,000 notes is the stated scale.
- `reins check` validates frontmatter, duplicate IDs, links, symbols, surfaces, and stale spans.
- Agents propose notes through one write path; humans accept them.

Conflicting records:

- **ADR-010** says no layer system, no ordering file, type plus links do the job.
- **ADR-012** says no search library and a linear scan.
- **ADR-003** says no second database, no SQLite.

The node tree reintroduces layers and directory structure (ADR-010 is superseded), the index replaces the scan (ADR-012 is superseded), and the index is a cache, not a store (ADR-003 is preserved and clarified). ADR-019 (OpenSpec as knowledge source) is preserved: OpenSpec stays read-only and is imported as accepted nodes at the tree root.

## 2. Node model

### 2.1 Layout

```text
.reins/knowledge/
  template.md                 # required. Declares layers, fields, naming, and rules.
  _rules.md                   # optional. Tree-wide guidance for humans and agents.
  _aliases.yaml               # optional. Query aliases, curated by humans.
  index.yaml                  # optional. Root ordering and grouping hints.
  components/
    billing/
      _rules.md               # boundary rules, loaded as context, never listed
      index.yaml              # optional ordering hint
      billing.md              # node, type: spec
      refund-ledger-first.md  # node, type: decision
    checkout/
      _rules.md
      checkout.md
  workflows/
    review.md
```

### 2.2 Definitions

- **Node.** One markdown file below `.reins/knowledge/`, not prefixed with `_`, with valid frontmatter. Identity is its path relative to `.reins/knowledge/`, without the `.md` suffix. That address is stable across renames of the id field and is what comments and links use.
- **Component.** A directory below `.reins/knowledge/` that contains at least one node or a `_rules.md`. A component is also the boundary for coverage and for guidance inheritance.
- **Guidance file.** A file whose stem starts with `_`. It is never a node, never appears in a tree, list, or search result, and is loaded as context for the enclosing directory and its descendants.
- **Layer.** A level declared in `template.md` by name and path glob. A node's layer is the first matching glob. Depth is a convention, not a rule; a template may put two layers at the same depth.
- **Index file.** `index.yaml` or `index.json` in a directory. Declares ordering and grouping hints. This change reads `order: [node-address, ...]` and `groups: [{ title, nodes: [...] }]`. Anything else is preserved and ignored.

### 2.3 Frontmatter additions

Existing required fields stay: `title`, `type`, `status`, `created`, `updated`. `id` is no longer the filename stem; it becomes an optional stable slug used in links, defaulting to the address. New optional fields:

| Field | Rule |
| --- | --- |
| `component` | Path of the owning component, relative to the knowledge root. Derived from the file location; a mismatch is an error. |
| `layer` | One of the layer names in `template.md`. Derived from the location glob when absent; a value not declared is an error. |
| `boundary` | Boolean. True when this node defines the contract of its component. At most one per component. |
| `supersedes` | Node address, not id. Accepted for compatibility with old notes. |

`type` stays closed: `spec`, `decision`, `constraint`, `howto`, `question`. A component is a place, not a type. A node that describes a whole component uses `type: spec` and `boundary: true`.

### 2.4 Tree rules

1. `template.md` must exist once the tree has any node. Without it, `reins knowledge check` fails with `TEMPLATE_MISSING` and the studio refuses to create nodes.
2. No node above the first layer glob. The root may hold guidance files and `template.md` only.
3. Reserved names: `template.md`, any `_` stem, `index.yaml`, `index.json`. A node may not use them.
4. Guidance files may appear in any directory. A child inherits every ancestor guidance file, nearest last.
5. Node file names are lowercase kebab case, 2 to 64 characters, and unique within the component.
6. An empty directory is ignored, not an error. A directory with an `index.yaml` and no node is a `EMPTY_COMPONENT` warning.

## 3. `template.md` contract

The template is the single source for structure. It has a small required shape and free prose below it.

```markdown
# Knowledge template

## Layers

| Layer | Glob | Purpose |
| --- | --- | --- |
| product | `product/**` | Product intent and requirements |
| component | `components/**` | One directory per code component |
| delivery | `workflows/**` | How work is done |

## Required fields

title, type, status, created, updated

## Naming

- Node files: lowercase kebab case.
- Components: match the code directory they cover.

## Rules

1. A component node states the contract, not the implementation.
2. A decision names what was ruled out and why.

## Aliases

See `_aliases.yaml`.
```

- The `Layers` table is required. Each row needs a unique name and a glob that does not escape the root.
- `Required fields` may add fields to the base set. It may not remove base fields.
- Prose below the tables is guidance. It is not parsed beyond the required sections.
- The template is validated by `reins knowledge check` and shown in the studio editor next to the form.
- Editing the template is a normal file edit with a diff. The studio validates before save and never writes a template that fails validation.

## 4. Fast index

### 4.1 Shape

```ts
interface KnowledgeIndex {
  version: 1;
  builtAt: string;
  templateHash: string;
  aliasesHash: string;
  nodes: IndexedNode[];
  terms: Record<string, Posting[]>; // token -> node ordinal and field frequencies
  addresses: Citation[];             // node ordinal to path and range
}
```

The index is written to `.reins/.cache/knowledge-index.json`. It is disposable: deleting it changes latency only. Markdown stays the source.

### 4.2 Build

1. Walk the knowledge tree, skipping `.cache/`, `inbox/` for accepted queries, and configured ignores.
2. For each markdown file, stat first. Reuse the previous entry when size and mtime match. Otherwise hash the body and reparse only when the hash changed.
3. Parse frontmatter and headings, tokenize, and record field frequencies: title, tags, headings, body, link labels.
4. Apply alias pairs from `_aliases.yaml` at query time, not at build time, so an alias edit does not force a rebuild. Watch the aliases file separately.
5. Merge into the previous index. A deleted file drops its entry.
6. Write atomically through a temporary file and rename. A failed write leaves the previous index valid.

### 4.3 Query

- Tokenize with lowercase, Unicode letters and digits, split on non-word characters, drop a small stop list per language, apply a suffix stemmer limited to plurals and common verb endings. No stemming library.
- Score with BM25 (`k1 = 1.2`, `b = 0.75`). Field weight multiplies term frequency: title `4`, tags `3`, headings `2`, body `1`, link labels `1`.
- Additive bonuses: exact title match `6`, phrase match `3`, component name match `2`.
- Intent routing reads the query for trigger words and sets a default type filter, which the caller can override: `requirement|spec|must|shall` to `spec`; `why|decision|chose|ruled` to `decision`; `technical|architecture|how|design` to `howto` and `decision`; `rule|never|forbid` to `constraint`; `question|open` to `question`.
- Alias expansion: a query token that matches an alias key adds its values with weight `0.6`. Aliases are one-way pairs, capped at 32 per key.
- Ties break by `updated` descending, then address ascending. Ranking is deterministic for one index revision.
- Every result carries the address, title, type, component, score, and a two-line excerpt with the best matching span. `--json` carries the same fields.

### 4.4 Budgets

Targets, to be measured on the recorded machine before acceptance, not claimed now:

| Operation | Target |
| --- | --- |
| Cold full build, 2,000 nodes, 20 MB | under 1,500 ms |
| Warm incremental build, 20 changed files | under 150 ms |
| Query, p95 | under 50 ms |
| Context pack for one code path | under 80 ms, under 4,000 estimated tokens |

The build reports `filesScanned`, `filesParsed`, `filesReused`, `bytes`, and `tookMs` in verbose mode and in `--json`. A run over budget is reported, not silently accepted.

### 4.5 What the index is not

- Not a copy of the code graph. It stores node text and link targets only. Symbol verification still asks Trail.
- Not durable state. It is gitignored with the rest of `.reins/.cache/`.
- Not a place for guidance files. `_` files are loaded on demand for context and rules, never indexed for listing or ranking.

## 5. Studio

### 5.1 Surfaces

- **Tree.** Left rail: layers, then components, then nodes. Guidance files and index files are hidden. A component shows coverage state as a dot with a tooltip.
- **Editor.** Markdown editor with a form for frontmatter. The template's required fields and prose render as a checklist beside the form.
- **Context.** Right rail: nearest guidance files, parent boundary node, typed links and backlinks, and the comment thread.
- **Review.** Save produces a diff. A human can save as draft, propose, or accept. Accept moves the file out of `inbox/` in the same interaction and shows the resulting Git diff.
- **Bootstrap.** A wizard over the Trail graph, with a preview tree and per-component toggles.

### 5.2 Write path

- Human actions in the studio write files directly, with a temporary file and rename, and never commit.
- Agent actions never reach these endpoints. They use `reins_knowledge_propose` and land in `inbox/`.
- Validation runs before write. Blocking errors prevent the write and keep the editor contents.
- Every write records `updated` and leaves the rest of the body byte-identical.

### 5.3 Behaviour

- Works offline and with the index absent. If the index is stale, the studio rebuilds it before the first query and shows progress.
- Keyboard: `Cmd+K` query, `Cmd+S` save, `Cmd+Enter` propose, `Esc` close panel.
- Accessibility: every tree row and coverage dot has a text label, focus order follows the visual order, and the editor is reachable without a pointer.
- Scale: a 5,000 node tree expands a component in under 100 ms with virtualized rows. No whole-repository load on open.

## 6. Bootstrap from code

Command: `reins knowledge init --from-code [--dry-run | --write] [--max-components N]`.

1. Require a Trail graph and a clean `reins` config. Do not build a graph as a side effect.
2. Read workspace packages, top-level source directories, and Trail's file clusters. Derive candidate components: package name plus relative path.
3. Map each candidate to a knowledge path, defaulting to `components/<slug>/`. Skip generated, vendored, and test-only directories.
4. Produce a plan: template (if missing), component directories, `_rules.md` stubs, one `type: spec` node per component with `title` set to the component name, `status: proposed`, and a body that states only what was observed (language, file count, entry points) with a `TODO` marker. No invented business claims.
5. Preview by default. `--write` is required to touch disk. The plan lists every path and every node that will be created, plus what was skipped and why.
6. Cap at 50 components unless `--max-components` raises it. Exit `3` when the cap is hit.
7. Never modify code, never commit, never write outside `.reins/knowledge/`.

## 7. Sync model

Coverage is computed per component from the tree and the graph:

| State | Meaning | Severity |
| --- | --- | --- |
| `covered` | At least one accepted node, and every node link resolves. | none |
| `stale` | A node links a file or symbol that changed after `updated`. | warning |
| `orphan` | A node's component has no matching code directory. | warning |
| `unmapped` | A code area above the configured size has no component node. | info |
| `invalid` | Template, frontmatter, or link error. | error |

- The component to code mapping comes from `component.code` in frontmatter when present, else from the template glob convention, else from the component name matched against package and directory names.
- `reins knowledge check` reports each state with `path`, `component`, `state`, and `fix`.
- The studio shows the state on the tree dot and in the component header.
- Nothing is auto-fixed. Suggestions are text.

## 8. Comments over git notes

- Ref: `refs/notes/reins`. Payload is one JSON document per target commit:

```json
{
  "version": 1,
  "threads": [
    {
      "node": "components/billing/refund-ledger-first",
      "comments": [
        { "id": "c1", "author": "tuevo", "at": "2026-11-27T10:00:00Z", "body": "...", "resolved": false }
      ]
    }
  ]
}
```

- Read path: list commits touching the node file, capped at 50, then read notes for those commits and merge threads by node address.
- Write path: append to the note of the current `HEAD` commit for that node with `git notes --ref=refs/notes/reins add -f`. Requires an explicit human action.
- Never push or fetch automatically. The CLI prints the refspec a person needs (`git push origin refs/notes/reins`).
- If the ref is absent or Git rejects the note, the studio hides the thread and keeps editing fully functional. A read failure is not an error state.
- Open question in the proposal: a fallback thread file if hosting drops the ref. No fallback is built in this change.

## 9. Agent surfaces

- Skill `reins-knowledge`: query before reading code, request a context pack for the code path, propose rather than write, and never accept a node.
- MCP tools: `reins_knowledge_search`, `reins_knowledge_get`, `reins_knowledge_context`, `reins_knowledge_check`, and the existing single write tool `reins_knowledge_propose`.
- The context pack is the high-value tool: given a repository-relative code path, it returns the owning component node, inherited guidance (rules only, capped), linked decisions and constraints, and a one-line reason per item. It never returns the index or a raw body dump.
- Token caps: 4,000 estimated tokens per pack, 20 results per search, 8 guidance files per pack.
- Agent output uses repository-relative paths only and never exposes absolute paths.

## 10. CLI

```bash
reins knowledge init [--from-code] [--dry-run] [--write]
reins knowledge new --type spec --component components/billing --title "..."
reins knowledge get <address|id>
reins knowledge search "<query>" [--type spec] [--limit N]
reins knowledge context <code-path>
reins knowledge check [--json]
reins knowledge migrate [--dry-run] [--write] [--map <old>=<new>]
reins ask "<question>"
reins studio
```

- Every query supports `--json` and the existing exit codes.
- `migrate` is the only command that moves accepted files. It requires `--write`, prints the full mapping, and uses `git mv` so history follows.
- `new` refuses to write a node that fails validation and prints the field errors.

## 11. Migration from flat notes

1. Read the old tree. Map each type folder to a target component, supplied by `--map` or confirmed interactively; there is no guessed default.
2. Rewrite frontmatter: drop the id-as-filename assumption, set `component` and `layer`, keep `links` and convert note ids to addresses when the target is known.
3. Move with `git mv`, and keep a `migration.md` note that lists every old path and new path.
4. Leave unknown targets in `inbox/` as `proposed`, never delete them.
5. `reins knowledge check` must pass after migration or list the exact remaining errors.

## 12. Alternatives rejected

| Alternative | Why rejected |
| --- | --- |
| A separate `.reins/nodes/` store beside notes | Two knowledge models to explain and link across. Chosen: unify. |
| SQLite FTS5 | Native dependency, second database, breaks the Phase budget and ADR-003. The measured need is thousands of nodes, not millions. |
| Embeddings for "semantic" search | Needs a model or a bundled runtime. The requirement is no AI. Lexical meaning covers product vocabulary well when aliases are curated. |
| Keeping type folders as the tree | Loses component ownership and per-directory rules, which is the point of the change. |
| Comment threads as files in the knowledge tree | Pollutes the source tree and creates merge conflicts on every thread. Git notes keep threads out of the working tree. |
| Auto-writing accepted nodes from code | Invents intent from implementation. Bootstrap writes proposals only. |

## 13. Decisions to record when accepted

- **ADR-021: directory tree nodes.** Knowledge is a tree of components, one markdown node per intent, guidance by `_` files, template at the root. Supersedes ADR-010.
- **ADR-022: disposable lexical index.** A pure TypeScript cache in `.reins/.cache/`, no model, no native store. Supersedes ADR-012.
- **Clarify ADR-003.** A disposable knowledge index is not a copy of the code graph.

## 14. Risks

| Risk | Response |
| --- | --- |
| Template becomes bureaucracy and people stop writing nodes | Keep the required shape to a layer table and required fields. Validation reports warnings, blocks only on structural errors. |
| Alias file rots | Ship a starter alias file, report unused aliases in `check`, and keep expansion weighted low. |
| Git notes dropped by hosting | Spike before implementing. The feature is optional and degrades to no thread. |
| Index and files diverge | Index is rebuilt from stat and hash on every query when stale. A mismatch is a rebuild, never a wrong answer. |
| Migration loses links | Migration is explicit, uses git mv, and leaves unresolved targets in `inbox/` rather than deleting them. |
