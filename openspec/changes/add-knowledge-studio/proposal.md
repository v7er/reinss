# Knowledge studio

## Why

Reins stores notes in flat type folders: `specs/`, `decisions/`, `constraints/`, `howto/`, `questions/`. That shape loses the shape of the repository. A real codebase is components and boundaries, each with local rules, requirements, and decisions. A flat folder makes a human hunt for the node that owns a directory, and makes an agent re-read code because it cannot find the intent behind that directory.

The result is knowledge that drifts. Nodes do not know which component they describe, code has no node when intent changed, and agent proposals and human edits share no review path. Search is a linear scan over title, body, tags, and symbol names, so an agent asking a product question gets a lexical guess, not an answer with a path and a reason.

This change makes knowledge a tree that mirrors the repository, gives it a template and a validation gate, indexes it in milliseconds without a model, and exposes the same queries to the studio, the CLI, and agents.

## What changes

- **Node model.** A node is a markdown file with YAML frontmatter under `.reins/knowledge/`. The directory that contains it is its component or boundary. `type` stays in frontmatter, folders no longer encode it.
- **Tree grammar.** `.reins/knowledge/template.md` declares layer names, allowed paths, required fields, and naming rules. Files prefixed with `_` are guidance for humans and agents, never nodes and never listed in the UI. `index.yaml` or `index.json` per directory declares ordering and grouping. Both are read in this change; their full semantics land later.
- **Knowledge studio.** A desktop surface and CLI flow to create, edit, browse, validate, and propose nodes. Save is a file write, never a database write. Agents still write only to `inbox/`.
- **Fast index.** A pure TypeScript index, cached as disposable JSON under `.reins/.cache/`, rebuilt incrementally from file metadata. BM25-style ranking with field boosts, a committed alias file, and intent routing (`requirement`, `spec`, `technical`, `why`). No model, no network, no native dependency, no second database.
- **Agent surfaces.** `reins ask`, `reins knowledge get`, and `reins knowledge context <code-path>` for the smallest pack that explains an area. MCP tools with the same contracts, plus the `reins-knowledge` skill.
- **Bootstrap.** `reins knowledge init --from-code` reads the Trail graph, proposes a component tree, and writes nothing until a person confirms. Every generated node starts as `proposed`.
- **Sync.** Coverage per component: covered, stale, orphan node, unmapped directory. `reins knowledge check` reports drift instead of letting it accumulate.
- **Comments.** A node thread stored in git notes under `refs/notes/reins`, read by the studio, written only by an explicit human action.

## Capabilities affected

| Capability path | Change |
| --- | --- |
| `openspec/specs/knowledge-ledger/spec.md` | MODIFIED. Directory tree, node identity, template, validation, sync coverage, git notes. |
| `openspec/specs/knowledge-studio/spec.md` | ADDED. Authoring, browsing, bootstrap, review gate. |
| `openspec/specs/knowledge-index/spec.md` | ADDED. Build, ranking, aliases, intent routing, budgets. |
| `openspec/specs/cli-and-mcp/spec.md` | MODIFIED. New commands and tools, bootstrap extension, one write path preserved. |

## Impact

- `packages/core`: node types, tree grammar, template schema, index query and result types, error codes. Pure, no filesystem.
- `packages/node`: tree reader, template loader, index builder and query engine, coverage checker, bootstrap planner, git notes reader and writer.
- `apps/cli`: `reins knowledge <subcommand>`, `reins ask`, `reins studio`, MCP tool registration.
- `apps/desktop` and `packages/ui`: studio route, tree, editor, validation panel, comment thread.
- `docs/03-data-contracts.md` section 7: new node and index contracts, frontmatter fields, error codes.
- `docs/01-product-spec.md` section 5.5, `docs/02-architecture.md`, `docs/06-ai-harness.md` skill catalog and MCP tool list.
- `docs/07-decisions-and-risks.md`: ADR-010 (no layer system) and ADR-012 (no search library, linear scan) are superseded. ADR-003 needs a clarification that a disposable knowledge index is not a second code graph. New records for the node model and the index.
- Existing notes under `.reins/knowledge/` need an explicit migration. No silent move.
- `RULES.md` needs no new dependency for the index. No native package is added.

## Out of scope

- Embeddings, vector search, any LLM call, any network request. "Semantic" here means lexical meaning: stemming, aliases, phrase and field boosts, intent routing.
- SQLite, FTS5, or any native index dependency.
- Writing to or restructuring `openspec/`. It stays read-only knowledge.
- Automatic edits to accepted nodes by agents. The single write path stays `inbox/`.
- Full `index.yaml` semantics beyond ordering and grouping hints.
- Syncing knowledge between machines or people outside Git.
- A plugin API for node kinds. Kinds stay a closed set.
- Windows and Linux packaging.

## Open questions

1. Git notes are not fetched or pushed by default. If a hosting provider drops `refs/notes/reins`, should the studio fall back to a thread file inside the knowledge tree, or refuse to show threads? A spike decides this before the comment requirement is implemented.
2. Must every component map to a code directory, or may a boundary exist before code (for example a planned package)? The sync requirement allows both, but the check severity for the second differs.
3. Default layer count and names are project specific. The template may require at least two layers and no fixed names. Confirm this in review.
