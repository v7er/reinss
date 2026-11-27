# Tasks: knowledge studio

Status after implementation:

- Done: core tree types and template parser, index and query engine, tree loader, save and accept, coverage, bootstrap, migration, comments over Git notes, session methods, sidecar dispatch, MCP tools, CLI commands, studio UI, ADR-021/022, data contracts, harness docs, the `reins-knowledge` skill.
- Not done: the three repository fixtures (tests use temporary repositories), a formal benchmark run for 4.7/10.4, the no-dependency assertion test (4.8), the end-to-end agent transcript (9.3), and exercising the studio in the running desktop app (no display here).
- Added after the first implementation: settings page with local provider discovery, Studio Initialize flow. built-in templates (`default`, `minimal`, `c4`, `domain`), opt-in AI drafting in `knowledge init --ai`, removal of the Check tab, and removal of the old note concept.
- Note removal: the flat note API, `notes` and `note` CLI commands, and `KnowledgeBoard` are deleted. `proposeNode` replaces `proposeNote`; Git-notes comments gained a push hint and show comments on uncommitted nodes.
- Deviations: `reinss studio` prints how to start the desktop app instead of launching it; index reuse is by content hash, not a stat fast path; the studio edits an existing node by saving the same address, but has no rich markdown editor or diff-before-save gate.

Do the phases in order; each phase leaves a verifiable state.

## 1. Record the decisions first

- [ ] 1.1 Add ADR-021 (directory tree nodes) and ADR-022 (disposable lexical index) to `docs/07-decisions-and-risks.md`, and mark ADR-010 and ADR-012 superseded with the new record ids. Verify: `grep -n "ADR-021\|ADR-022\|superseded" docs/07-decisions-and-risks.md`
- [ ] 1.2 Clarify ADR-003: a disposable knowledge index is not a copy of the code graph. Verify: `sed -n '/ADR-003/,/ADR-004/p' docs/07-decisions-and-risks.md`
- [ ] 1.3 Extend `docs/03-data-contracts.md` section 7 with the node address, tree grammar, template contract, index cache format, and the new error codes. Verify: `rg -n "Knowledge nodes|Node address|template.md" docs/03-data-contracts.md`
- [ ] 1.4 Update the affected requirements in `docs/01-product-spec.md` 5.5 and the tool and skill lists in `docs/06-ai-harness.md`. Verify: `grep -n "knowledge" docs/01-product-spec.md docs/06-ai-harness.md`

## 2. Core model

- [ ] 2.1 Add node, component, layer, template, and address types plus the tree grammar to `packages/core`, with no filesystem import. Verify: `pnpm typecheck`
- [ ] 2.2 Add a pure template parser and validator: layer table, required fields, glob overlap, escaping globs. Verify: `pnpm vitest run packages/core`
- [ ] 2.3 Add a pure frontmatter and heading parser for nodes, reusing the existing note parser where it fits. Verify: `pnpm vitest run packages/core`
- [ ] 2.4 Add `KnowledgeNode`, `ComponentSummary`, `CoverageState`, `KnowledgeQuery`, and `KnowledgeResult` to the core API and the JSON schema tests. Verify: `pnpm test`
- [ ] 2.5 Add error codes `TEMPLATE_MISSING`, `NODE_NOT_FOUND`, `NODE_EXISTS`, `LAYER_UNDECLARED`, `COMPONENT_MISMATCH`, `GUIDANCE_INVALID`, `PATH_ESCAPE`. Verify: `pnpm test`

## 3. Tree reader and validation

- [ ] 3.1 Implement the tree walker in `packages/node`: skip cache and ignored paths, separate nodes from guidance and index files, derive components and inheritance order. Verify: `pnpm vitest run packages/node`
- [ ] 3.2 Implement address resolution, duplicate detection, and component/layer derivation. Verify: `pnpm vitest run packages/node`
- [ ] 3.3 Extend `reinss check` with template, layer, component, guidance naming, and index file findings. Verify: `pnpm reinss check --json` on a fixture with one of each violation.
- [ ] 3.4 Add three fixtures under `test/fixtures`: a valid tree, a template-violating tree, and a tree with orphan and unmapped components. Verify: `pnpm test`

## 4. Index engine

- [ ] 4.1 Implement the tokenizer, stop list, and light stemmer in core, with a table test for the documented behaviour. Verify: `pnpm vitest run packages/core`
- [ ] 4.2 Implement BM25 scoring with field weights, exact and phrase bonuses, and deterministic tie breaks. Verify: `pnpm vitest run packages/core`
- [ ] 4.3 Implement the cache format, stat reuse, hash reparse, and atomic write in `packages/node`. Verify: `pnpm vitest run packages/node`
- [ ] 4.4 Implement alias expansion from `_aliases.yaml` with the weight and cap from the design. Verify: `pnpm vitest run packages/node`
- [ ] 4.5 Implement intent routing with an explicit override and a stated filter in the result. Verify: `pnpm vitest run packages/node`
- [ ] 4.6 Implement the context pack resolver with reason lines and token cap. Verify: `pnpm vitest run packages/node`
- [ ] 4.7 Measure cold build, warm build, query p95, and pack size on the recorded machine and write the numbers into the design table. Verify: rerun the benchmark command recorded in the design and compare.
- [ ] 4.8 Assert the offline and no-dependency rule with a test that fails when a model or search package is imported. Verify: `pnpm test`

## 5. CLI

- [ ] 5.1 Add `reinss ask`, `reinss knowledge get`, `search`, and `context` with `--json` and the existing exit codes. Verify: `node apps/cli/dist/main.js ask "refund policy" --json`
- [ ] 5.2 Add `reinss knowledge new` and `check`, writing only after validation. Verify: `node apps/cli/dist/main.js knowledge new --type spec --component components/billing --title "Refund policy"` on a fixture.
- [ ] 5.3 Add `reinss studio` as a thin launcher for the desktop route. Verify: `node apps/cli/dist/main.js studio --help`
- [ ] 5.4 Add `reinss knowledge migrate` with preview by default, `git mv`, and unresolved nodes left in `inbox/`. Verify: run on the migration fixture and diff `git status`.
- [ ] 5.5 Add the new MCP tools with schemas identical to core, capped results, and no new write tool. Verify: `pnpm vitest run apps/cli`

## 6. Bootstrap from code

- [ ] 6.1 Implement the component planner over the Trail graph: packages, source directories, clusters, caps, skip rules. Verify: `pnpm vitest run packages/node`
- [ ] 6.2 Emit the plan with every path, every node, and every skip reason; preview by default. Verify: `node apps/cli/dist/main.js knowledge init --from-code --dry-run` on the fixture repo.
- [ ] 6.3 Write only `proposed` nodes with observed facts and a TODO marker, never outside `.reins/knowledge/`. Verify: fixture run plus `git status --porcelain` review.
- [ ] 6.4 Return `GRAPH_MISSING` and the bootstrap cap error. Verify: `pnpm test`

## 7. Sync coverage

- [ ] 7.1 Compute covered, stale, orphan, unmapped, and invalid per component from the tree and the graph. Verify: `pnpm vitest run packages/node`
- [ ] 7.2 Add coverage to `reinss knowledge check` and to the session summary. Verify: `node apps/cli/dist/main.js knowledge check --json`
- [ ] 7.3 Prove no auto-fix: a fixture with every coverage state is unchanged after the check. Verify: `git diff --exit-code test/fixtures/<coverage-fixture>`

## 8. Studio

- [ ] 8.1 Add the studio route and tree with virtualized rows, coverage dots, and keyboard navigation. Verify: `pnpm dev`, open the route in the desktop app, exercise with keyboard only.
- [ ] 8.2 Add the node editor with frontmatter form, template checklist, validation panel, diff preview, and atomic save. Verify: create, break, fix, and save a node in the app; confirm the file diff.
- [ ] 8.3 Add the guidance rail and the linked nodes rail. Verify: open a node under a component with `_rules.md` and linked decisions.
- [ ] 8.4 Add the proposal review flow: accept moves the file, reject keeps it in `inbox/`, no commit. Verify: accept and reject one proposal, then inspect `git status`.
- [ ] 8.5 Add the bootstrap wizard with preview and per-component toggles. Verify: run it on a fixture repository, cancel, confirm nothing changed, then confirm and inspect.
- [ ] 8.6 Add the comment thread panel, read-only when the notes ref is absent. Verify: add a comment, read it back, remove the ref, reopen the node.

## 9. Agent surfaces

- [ ] 9.1 Write `.agents/skills/reins-knowledge/SKILL.md` with triggers, steps, stop conditions, and the proposal-only rule. Verify: read it back against the skill format in `docs/06-ai-harness.md` section 3.
- [ ] 9.2 Add the tool descriptions and token caps to `docs/06-ai-harness.md` and the MCP contract tests. Verify: `pnpm test`
- [ ] 9.3 Run one end-to-end agent task on a fixture: ask, pack, propose, human accepts. Verify: recorded transcript plus `git status` showing only the accepted note moved.

## 10. Gates

- [ ] 10.1 `pnpm typecheck`, `pnpm test`, `pnpm build` pass. Verify: run all three and paste the result.
- [ ] 10.2 `openspec validate add-knowledge-studio --strict` passes. Verify: `npx --yes @fission-ai/openspec validate add-knowledge-studio --strict`
- [ ] 10.3 `trail check` reports no conflict with existing learnings. Verify: `trail check`
- [ ] 10.4 Measure the budgets and record the machine, date, and command next to each number. Verify: the recorded benchmark output.
- [ ] 10.5 Update the roadmap phase entry and the definition of done evidence. Verify: review diff of `docs/04-roadmap.md`.
