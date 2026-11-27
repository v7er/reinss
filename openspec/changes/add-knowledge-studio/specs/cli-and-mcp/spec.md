# CLI and MCP Specification

## Purpose

Expose the same operations to a terminal and an agent with stable JSON, stable exit codes, and one explicit write path.

## MODIFIED Requirements

### Requirement: Initialize a repository

The system SHALL create `.reins/` config, the knowledge template, and the knowledge folders, check Trail, run `trail init` only with consent, and never overwrite an existing config.

#### Scenario: Initializing a new repository

- **WHEN** the user runs `reins init`
- **THEN** `.reins/config.json`, `.reins/knowledge/template.md`, and the knowledge folders exist
- **AND** an existing config is not overwritten
- **AND** the output lists every created path

#### Scenario: Initializing an existing repository from code

- **WHEN** the user runs `reins knowledge init --from-code`
- **THEN** the command prints the component and node plan without writing when `--dry-run` is used or no write flag is given
- **AND** `--write` creates only `proposed` nodes under `.reins/knowledge/`
- **AND** no file outside `.reins/knowledge/` changes
- **AND** no commit is made

#### Scenario: No graph for bootstrap

- **WHEN** `--from-code` runs without a Trail graph
- **THEN** the command exits `2` with `GRAPH_MISSING`
- **AND** it does not build a graph

### Requirement: Expose operations over MCP

The system SHALL expose graph, surface, knowledge, and diff operations over MCP with schemas that match the core API and token-capped results.

#### Scenario: Calling a graph tool

- **WHEN** an MCP client calls `reins_callers`
- **THEN** the result matches the core graph contract
- **AND** the result names the repository and graph revision

#### Scenario: Asking about a component

- **WHEN** an MCP client calls `reins_knowledge_context` with a repository-relative code path
- **THEN** the result contains the owning node, inherited guidance, linked decisions and constraints, and one reason per item
- **AND** the result stays under the pack token cap

#### Scenario: Reaching the result cap

- **WHEN** an MCP knowledge search would exceed the result cap
- **THEN** the result is capped
- **AND** it reports the total and the cap

## ADDED Requirements

### Requirement: Query knowledge from the terminal

The system SHALL provide `reins ask`, `reins knowledge search`, `reins knowledge get`, and `reins knowledge context` with human output and `--json` output.

#### Scenario: Asking a product question

- **WHEN** the user runs `reins ask "why do refunds write to the ledger first"`
- **THEN** the command prints ranked nodes with address, title, type, component, and excerpt
- **AND** `--json` returns the same fields in one envelope

#### Scenario: Reading one node

- **WHEN** the user runs `reins knowledge get components/billing/refunds`
- **THEN** the command prints the frontmatter and body
- **AND** an unknown address exits `1` with `NODE_NOT_FOUND`

#### Scenario: Missing index

- **WHEN** the cache is absent
- **THEN** the command builds it before answering
- **AND** it reports the build time in verbose and JSON output

### Requirement: Manage nodes from the terminal

The system SHALL provide `reins knowledge new`, `reins knowledge check`, and `reins knowledge migrate` with an explicit write flag for anything that moves or creates accepted files.

#### Scenario: Creating a node

- **WHEN** the user runs `reins knowledge new --type spec --component components/billing --title "Refund policy"`
- **THEN** the command writes a validated node and prints its address
- **AND** an invalid field exits `1` and writes nothing

#### Scenario: Checking the tree

- **WHEN** the user runs `reins knowledge check`
- **THEN** the command reports template, frontmatter, link, and coverage findings with severity and path
- **AND** any error exits `1`

#### Scenario: Migrating flat notes

- **WHEN** the user runs `reins knowledge migrate` without `--write`
- **THEN** the command prints the full old path to new path mapping and writes nothing
- **AND** with `--write` it moves files with `git mv` and leaves unresolved nodes in `inbox/`

### Requirement: Open the studio

The system SHALL provide `reins studio` to open the desktop knowledge studio for the current repository.

#### Scenario: Opening the studio

- **WHEN** the user runs `reins studio`
- **THEN** the desktop app opens on the knowledge tree for the current repository
- **AND** a repository without `.reins/knowledge/template.md` shows the initialization step instead of an empty tree

### Requirement: Keep the single write path

The system SHALL expose exactly one MCP write tool, `reins_knowledge_propose`, and SHALL write only to the knowledge inbox.

#### Scenario: Proposing through MCP

- **WHEN** an MCP client calls `reins_knowledge_propose`
- **THEN** the node lands in `inbox/` with `status: proposed`
- **AND** no accepted folder is written
- **AND** the result includes the diff

#### Scenario: Attempting a direct write

- **WHEN** an MCP client looks for a tool that writes an accepted node or edits the template
- **THEN** no such tool exists
- **AND** the studio write paths remain human only

### Requirement: Return stable knowledge errors

The system SHALL return stable error codes for knowledge operations, with the path and the field when a file is at fault.

#### Scenario: Missing template

- **WHEN** a knowledge command needs a template and none exists
- **THEN** the command exits `1` with `TEMPLATE_MISSING`

#### Scenario: Path escape

- **WHEN** a command is given a path outside the knowledge root
- **THEN** the command exits `1` with `PATH_ESCAPE`
- **AND** no file is read or written

#### Scenario: Bootstrap cap

- **WHEN** bootstrap would create more components than the cap
- **THEN** the command exits `3`
- **AND** the error names the cap
