# CLI and MCP Specification

## Purpose

Expose the same operations to a terminal and an agent with stable JSON, stable exit codes, and one explicit write path.

## Requirements

### Requirement: Provide JSON mode

The system SHALL provide `--json` for every query and SHALL validate the output against the documented schema.

#### Scenario: Running a query with JSON

- **WHEN** the user passes `--json`
- **THEN** stdout contains one JSON envelope
- **AND** errors go to stderr with a stable code

### Requirement: Keep exit codes stable

The system SHALL use `0` for success, `1` for a user or query error, `2` for an environment error, `3` for a limit exceeded, and `4` for an internal error.

#### Scenario: Missing Trail

- **WHEN** Trail is not installed
- **THEN** the command exits `2`
- **AND** the error code is `TRAIL_MISSING`

#### Scenario: Exceeding a cap

- **WHEN** a result exceeds a hard cap
- **THEN** the command exits `3`
- **AND** the error code names the limit

### Requirement: Initialize a repository

The system SHALL create `.reins/` config and knowledge folders, check Trail, run `trail init` only with consent, and never overwrite an existing config.

#### Scenario: Initializing a new repository

- **WHEN** the user runs `reins init`
- **THEN** `.reins/config.json` and the knowledge folders exist
- **AND** an existing config is not overwritten

### Requirement: Expose operations over MCP

The system SHALL expose graph, surface, knowledge, and diff operations over MCP with schemas that match the core API and token-capped results.

#### Scenario: Calling a graph tool

- **WHEN** an MCP client calls `reins_callers`
- **THEN** the result matches the core graph contract
- **AND** the result names the repository and graph revision

### Requirement: Write only through a proposal path

The system SHALL expose exactly one write tool, `reins_knowledge_propose`, and SHALL write only to the knowledge inbox.

#### Scenario: Proposing through MCP

- **WHEN** an MCP client calls `reins_knowledge_propose`
- **THEN** the note lands in `knowledge/inbox/`
- **AND** the result includes a diff

### Requirement: Emit a context pack

The system SHALL return deterministic markdown under a token budget from `reins_harness_pack`.

#### Scenario: Requesting a pack

- **WHEN** an MCP client requests a pack with a token budget
- **THEN** the result is markdown within the budget
- **AND** the same inputs produce the same pack
