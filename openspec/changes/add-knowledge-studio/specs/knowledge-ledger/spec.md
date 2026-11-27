# Knowledge Ledger Specification

## Purpose

Keep project intent next to the code as committed markdown, shaped like the repository: components, boundaries, local guidance, and typed links. Markdown is the only source; caches are disposable; a human accepts every agent proposal.

## MODIFIED Requirements

### Requirement: Store knowledge as committed markdown

The system SHALL store nodes as committed markdown files in a directory tree under `.reins/knowledge/`, SHALL treat the containing directory as the node's component or boundary, and SHALL read OpenSpec under `openspec/` as read-only knowledge.

#### Scenario: Reading a note without Reins

- **WHEN** a person opens a note file
- **THEN** the note is readable and editable as plain markdown with YAML frontmatter
- **AND** the app does not store the node only in a database

#### Scenario: Reading OpenSpec

- **WHEN** the repository contains `openspec/`
- **THEN** Reins imports its files as nodes with `source: openspec`
- **AND** Reins never writes to `openspec/`

#### Scenario: Node address

- **WHEN** a node exists at `.reins/knowledge/components/billing/refunds.md`
- **THEN** its address is `components/billing/refunds`
- **AND** the address is repository relative and stable across an `id` rename

### Requirement: Support note types

The system SHALL support `spec`, `decision`, `constraint`, `howto`, and `question` as the closed set of node types and SHALL reject an unknown type with a path and field.

#### Scenario: Rejecting an unknown type

- **WHEN** a node declares an unknown type
- **THEN** validation fails
- **AND** the error names the file and the field

#### Scenario: Type is not a folder

- **WHEN** a node of type `decision` sits under `components/billing/`
- **THEN** the node is valid
- **AND** its component is `components/billing`
- **AND** no type folder is required or created

#### Scenario: Boundary node

- **WHEN** two nodes in one component declare `boundary: true`
- **THEN** validation fails with the paths of both nodes

### Requirement: Search notes

The system SHALL search nodes through the knowledge index and SHALL rank title, tags, headings, body, and link labels with a deterministic rank.

#### Scenario: Searching by tag

- **WHEN** the user searches for a tag
- **THEN** nodes with that tag rank above body-only matches
- **AND** ties sort by `updated` then address

#### Scenario: Searching a node tree

- **WHEN** the user searches and the index is absent
- **THEN** the system builds it before answering
- **AND** the answer is the same as with a warm index

#### Scenario: Guidance is not a result

- **WHEN** the user searches
- **THEN** `_` guidance files, the template, and index files are not returned
- **AND** they remain available to the context operation

### Requirement: Validate the ledger

The system SHALL report invalid frontmatter, duplicate addresses, broken links, unknown symbols, unknown surfaces, stale code links, template violations, undeclared layers, component mismatches, guidance naming errors, and index file errors.

#### Scenario: Running a knowledge check

- **WHEN** the user runs `reinss check`
- **THEN** the report lists each item with severity, code, message, and path
- **AND** errors fail the check

#### Scenario: Missing template

- **WHEN** the tree contains a node and no `template.md`
- **THEN** the check reports `TEMPLATE_MISSING` as an error
- **AND** the studio refuses to create a node

#### Scenario: Wrong component field

- **WHEN** a node's `component` field does not match its directory
- **THEN** the check reports the expected and actual component
- **AND** the node is not silently rewritten

### Requirement: Require human review for proposals

The system SHALL write agent proposals to `knowledge/inbox/` with `status: proposed` and SHALL require an explicit human action to accept them.

#### Scenario: Proposing a note

- **WHEN** an agent proposes a node
- **THEN** the node lands in `inbox/` with `status: proposed`
- **AND** the result includes a diff for review

#### Scenario: Accepting a note

- **WHEN** a human accepts a proposal
- **THEN** the node moves to its component directory
- **AND** `status` becomes `accepted`
- **AND** the change is visible in Git

## ADDED Requirements

### Requirement: Declare tree structure in a template

The system SHALL require `.reins/knowledge/template.md` to declare layer names with path globs, required fields, naming rules, and prose guidance, and SHALL validate every node against it.

#### Scenario: Resolving a node's layer

- **WHEN** a node sits at a path matching one layer glob
- **THEN** its layer is that layer
- **AND** a `layer` field that names an undeclared layer is an error

#### Scenario: Overlapping globs

- **WHEN** two layer globs match the same node path
- **THEN** the first declared layer wins
- **AND** the check warns about the overlap

#### Scenario: Glob escapes the root

- **WHEN** a layer glob contains `..` or an absolute path
- **THEN** the template is invalid
- **AND** the error names the row

### Requirement: Inherit directory guidance

The system SHALL load `_` files as guidance for their directory and every descendant, SHALL treat the nearest file as the most specific, and SHALL exclude guidance from node listing, search, and indexed links.

#### Scenario: Reviewing a node rule

- **WHEN** a component has `_rules.md` and the root has `_rules.md`
- **THEN** a node in the component inherits both
- **AND** the component rule is reported after the root rule

#### Scenario: A guidance file is not a node

- **WHEN** a file named `_rules.md` sits in a component
- **THEN** it has no node address
- **AND** it is never counted as coverage for that component

### Requirement: Keep knowledge and code in sync

The system SHALL compute a coverage state for each component from the tree, node links, and the Trail graph, and SHALL report covered, stale, orphan, unmapped, and invalid states.

#### Scenario: Stale node link

- **WHEN** a linked symbol changed after the node's `updated` date
- **THEN** the component state is `stale`
- **AND** the report names the node, the link, and the current span

#### Scenario: Orphan component

- **WHEN** a component has no matching code directory and no `component.code` mapping
- **THEN** the state is `orphan` with a warning
- **AND** the node is not deleted

#### Scenario: No automatic fix

- **WHEN** a component is stale, orphan, or unmapped
- **THEN** the system reports the state and a suggestion
- **AND** it does not edit the node or the code

### Requirement: Discuss a node with git notes

The system SHALL read and write node comment threads in Git notes under `refs/notes/reins` and SHALL treat the notes ref as optional.

#### Scenario: Reading comments without the ref

- **WHEN** `refs/notes/reins` does not exist
- **THEN** every node has an empty thread
- **AND** no error is reported to the user

#### Scenario: Writing a comment

- **WHEN** a human adds a comment to a node
- **THEN** the comment is stored in the notes document for the current commit
- **AND** Reins does not commit, push, or fetch
- **AND** the node file does not change

#### Scenario: Merging branches with comments

- **WHEN** two branches add comments to the same node
- **THEN** Reins reads both sets of notes when both are present locally
- **AND** a conflicting notes ref is reported, not silently resolved
