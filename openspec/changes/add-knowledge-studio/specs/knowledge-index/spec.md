# Knowledge Index Specification

## Purpose

Turn a knowledge tree into a searchable index in milliseconds, on this machine, without a model, a network call, or a native dependency. The index answers plain questions and intent-shaped ones (`why`, `requirement`, `technical`) with a node address, a score, and a reason. Markdown stays the only source of truth; the index is disposable cache.

## ADDED Requirements

### Requirement: Index markdown into disposable cache

The system SHALL build the index only from markdown files under the knowledge directory and SHALL write it to `.reins/.cache/knowledge-index.json`.

#### Scenario: Deleting the cache

- **WHEN** the user deletes `.reins/.cache/knowledge-index.json`
- **THEN** the next query rebuilds it from markdown
- **AND** every answer matches the pre-deletion answer for the same files

#### Scenario: Cache is not a store

- **WHEN** the index exists and a note is edited outside Reins
- **THEN** the next query reflects the edit
- **AND** no answer depends on the cache alone

#### Scenario: Cache stays out of Git

- **WHEN** the index is written
- **THEN** the path is ignored by `.reins/.gitignore`
- **AND** a repository copy does not ship it

### Requirement: Rebuild incrementally

The system SHALL reuse index entries whose file size and modification time match, and SHALL reparse a file only when its content hash changed.

#### Scenario: A small edit

- **WHEN** one node changes and the user runs a query
- **THEN** the build parses that file only
- **AND** the result reports `filesParsed: 1` and the number reused

#### Scenario: A restored file

- **WHEN** a file's size and modification time match a previous run but its content differs
- **THEN** the system detects the hash mismatch and reparses the file

### Requirement: Rank with lexical meaning

The system SHALL rank results with BM25 scoring, field boosts, exact and phrase bonuses, and SHALL break ties deterministically.

#### Scenario: Title over body

- **WHEN** two nodes contain the same query term, one in its title and one only in its body
- **THEN** the title match ranks higher

#### Scenario: Exact title

- **WHEN** a node title equals the query
- **THEN** it ranks above every node that matches the term in a longer title or body

#### Scenario: Deterministic ties

- **WHEN** two nodes have the same score
- **THEN** the newer `updated` date ranks first
- **AND** equal dates sort by address ascending

### Requirement: Expand committed aliases

The system SHALL expand query terms with aliases from a committed file and SHALL keep expansion below the weight of a direct term match.

#### Scenario: Product vocabulary

- **WHEN** the user asks for a term that has an alias entry
- **THEN** nodes containing the alias values are returned
- **AND** each gets a lower contribution than a node containing the asked term

#### Scenario: Editing aliases

- **WHEN** the alias file changes
- **THEN** the next query uses the new aliases without a full index rebuild

### Requirement: Route intent to node type

The system SHALL detect requirement, decision, technical, rule, and open-question intent from query words, apply a default type filter, and allow the caller to override it.

#### Scenario: Asking why

- **WHEN** the user asks "why do refunds write to the ledger first"
- **THEN** decisions rank above other types
- **AND** an explicit `--type spec` overrides the routing

#### Scenario: No intent words

- **WHEN** the query has no intent words
- **THEN** all accepted types are searched
- **AND** the result states that no type filter was applied

### Requirement: Return evidence with each hit

The system SHALL return a node address, title, type, component, score, and a two-line excerpt that contains a matching span for every result.

#### Scenario: Reading a result without opening the file

- **WHEN** a query returns a result
- **THEN** the excerpt contains at least one query term or alias in context
- **AND** the address is repository relative

#### Scenario: No match

- **WHEN** no node matches
- **THEN** the result is an empty list with `tookMs`
- **AND** the system does not substitute an unrelated node

### Requirement: Exclude guidance from results

The system SHALL never return a `_` guidance file, the template, or an index file as a search result, and SHALL return them only through the explicit guidance or context operation.

#### Scenario: A query matching a rules file

- **WHEN** a query term appears only in `_rules.md`
- **THEN** no result is returned for that term
- **AND** the context pack for the containing code path still includes the rule

### Requirement: Build a context pack for a code path

The system SHALL resolve a repository-relative code path to its owning component, that component's node, inherited guidance, and typed links, within a token cap.

#### Scenario: Asking about a directory

- **WHEN** an agent asks for `src/billing/`
- **THEN** the pack contains the billing component node, the inherited rules, and the decisions and constraints linked from those nodes
- **AND** each item carries one line on why it is included
- **AND** the pack stays under the token cap

#### Scenario: No node owns the path

- **WHEN** no component maps to the code path
- **THEN** the pack states that the area is unmapped
- **AND** it does not invent a component

### Requirement: Respect and report budgets

The system SHALL enforce a result cap, a guidance cap, and a token cap, and SHALL report build and query timings.

#### Scenario: Over the result cap

- **WHEN** a query would return more results than the cap
- **THEN** the system returns the capped list
- **AND** reports the total and the cap

#### Scenario: Over budget

- **WHEN** a build or query exceeds its target
- **THEN** the result reports the measured time
- **AND** the system does not describe the run as fast in its output

### Requirement: Stay offline and model free

The system SHALL index and query without a network call, a child model process, or a native library.

#### Scenario: Offline query

- **WHEN** the machine has no network
- **THEN** indexing and querying still succeed

#### Scenario: Dependency review

- **WHEN** the index implementation is reviewed
- **THEN** it adds no runtime dependency
- **AND** no embedding model, tokenizer package, or search library is present
