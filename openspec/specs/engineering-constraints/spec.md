# Engineering Constraints Specification

## Purpose

State the boundaries that keep Reins small, local, and safe, so a change that breaks one is a defect rather than a preference.

## Requirements

### Requirement: Keep one graph source

The system SHALL use Trail's `graft/` as the only code graph and SHALL NOT copy it into SQLite, JSON, or a second store.

#### Scenario: Adding a graph-backed feature

- **WHEN** a feature needs graph data
- **THEN** it reads a Trail slice
- **AND** it does not create a second graph store

### Requirement: Keep one API

The system SHALL expose `ReinsApi` in `@reins/core` as the only operation surface and SHALL keep CLI, Tauri, and MCP as thin adapters.

#### Scenario: Adding an operation

- **WHEN** a new operation is added
- **THEN** it is defined in core
- **AND** every transport calls the same method

### Requirement: Keep core pure

The system SHALL keep `@reins/core` free of `node:*`, Tauri, React, and filesystem imports.

#### Scenario: Importing a Node module in core

- **WHEN** a change adds a `node:*` import to core
- **THEN** the boundary test fails
- **AND** the change is rejected

### Requirement: Keep Node out of the UI

The system SHALL keep `@reins/ui` free of `@reins/node`, Tauri, and `node:*` imports.

#### Scenario: Importing a Node adapter in the UI

- **WHEN** a change adds a Node adapter import to the UI
- **THEN** the boundary test fails
- **AND** the change is rejected

### Requirement: Work offline by default

The system SHALL index, graph, search, diff, and check knowledge without a network call and SHALL make any LLM feature opt-in.

#### Scenario: Running without a network

- **WHEN** the machine is offline
- **THEN** indexing, graph, search, diff, and knowledge check still work
- **AND** no LLM call is attempted

### Requirement: Never execute repository code

The system SHALL parse and read repository files only and SHALL use Trail and Git as the only child processes.

#### Scenario: Indexing a repository

- **WHEN** Reins indexes a repository
- **THEN** it does not run repository scripts, package managers, or tests
- **AND** the only child processes are Trail and Git

### Requirement: Keep the dependency whitelist

The system SHALL add a dependency only with a row in `RULES.md` and a reason in the pull request.

#### Scenario: Adding a package

- **WHEN** a change adds a runtime dependency
- **THEN** `RULES.md` has a row for it
- **AND** the pull request states why

### Requirement: Respect performance caps

The system SHALL enforce the caps in `RULES.md` for graph nodes, graph depth, surface scans, diff files, knowledge notes, MCP results, and harness packs.

#### Scenario: Exceeding a cap

- **WHEN** a result reaches a cap
- **THEN** the result is clamped
- **AND** the result states what was cut

### Requirement: Keep OpenSpec read-only

The system SHALL read `openspec/` as knowledge and SHALL NOT write to it.

#### Scenario: Proposing a note in a repository with OpenSpec

- **WHEN** an agent proposes a note
- **THEN** the note is written under `.reins/knowledge/inbox/`
- **AND** no file under `openspec/` changes
