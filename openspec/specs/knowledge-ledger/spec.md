# Knowledge Ledger Specification

## Purpose

Keep project intent next to the code as committed markdown, with typed links, backlinks, validation, and a human review gate for agent proposals.

## Requirements

### Requirement: Store knowledge as committed markdown

The system SHALL store Reins notes as committed markdown under `.reins/knowledge/` and SHALL read OpenSpec under `openspec/` as read-only knowledge.

#### Scenario: Reading a note without Reins

- **WHEN** a person opens a note file
- **THEN** the note is readable and editable as plain markdown
- **AND** the app does not store the note only in a database

#### Scenario: Reading OpenSpec

- **WHEN** the repository contains `openspec/`
- **THEN** Reins imports its files as notes with `source: openspec`
- **AND** Reins never writes to `openspec/`

### Requirement: Support note types

The system SHALL support `spec`, `decision`, `constraint`, `howto`, and `question` and SHALL reject an unknown type with a path and field.

#### Scenario: Rejecting an unknown type

- **WHEN** a note declares an unknown type
- **THEN** validation fails
- **AND** the error names the file and the field

### Requirement: Link notes to project objects

The system SHALL store typed links to notes, symbols, surfaces, commits, and files in frontmatter and SHALL resolve them in both directions.

#### Scenario: Following a link

- **WHEN** a note links to a symbol
- **THEN** the symbol link resolves to a Trail node ID
- **AND** the target note lists the source as a backlink

#### Scenario: Reporting a broken link

- **WHEN** a link target does not exist
- **THEN** `reins check` reports `LINK_BROKEN`
- **AND** the report names the source note and the target

### Requirement: Show backlinks

The system SHALL list every note, symbol, and surface that references a note.

#### Scenario: Opening a note

- **WHEN** the user opens a note
- **THEN** the view lists its backlinks
- **AND** each backlink names the source and the relation

### Requirement: Search notes

The system SHALL search title, body, tags, and linked symbol names with a stable rank.

#### Scenario: Searching by tag

- **WHEN** the user searches for a tag
- **THEN** notes with that tag rank above body-only matches
- **AND** ties sort by `updated` then `id`

### Requirement: Show a knowledge board

The system SHALL render notes as cards with typed edges and SHALL store card positions locally, not in the note.

#### Scenario: Moving a card

- **WHEN** the user moves a card
- **THEN** the position is stored in local state
- **AND** the note file does not change

### Requirement: Validate the ledger

The system SHALL report invalid frontmatter, duplicate IDs, broken links, unknown symbols, unknown surfaces, and stale code links.

#### Scenario: Running a knowledge check

- **WHEN** the user runs `reins check`
- **THEN** the report lists each item with severity, code, message, and path
- **AND** errors fail the check

### Requirement: Require human review for proposals

The system SHALL write agent proposals to `knowledge/inbox/` with `status: proposed` and SHALL require an explicit human action to accept them.

#### Scenario: Proposing a note

- **WHEN** an agent proposes a note
- **THEN** the note lands in `inbox/` with `status: proposed`
- **AND** the result includes a diff for review

#### Scenario: Accepting a note

- **WHEN** a human accepts a proposal
- **THEN** the note moves to its type folder
- **AND** `status` becomes `accepted`
- **AND** the change is visible in Git

### Requirement: Detect constraint violations

The system SHALL evaluate each constraint note with a machine-checkable rule against a diff and SHALL report pass, fail, or not-applicable.

#### Scenario: Violating a forbidden import

- **WHEN** a diff adds an import that a constraint forbids
- **THEN** the check reports `CONSTRAINT_VIOLATED`
- **AND** the report names the constraint and the file

#### Scenario: Skipping an unevaluable rule

- **WHEN** a rule cannot be evaluated
- **THEN** the check reports `CONSTRAINT_SKIPPED` with a reason
- **AND** the rule does not silently pass

### Requirement: Import OpenSpec knowledge

The system SHALL import OpenSpec config, specs, proposals, designs, and tasks as read-only notes and SHALL map each file to a note type.

#### Scenario: Importing a change design

- **WHEN** `openspec/changes/<change>/design.md` exists
- **THEN** Reins imports it as a `decision` note
- **AND** the note carries `source: openspec`

#### Scenario: Listing OpenSpec files

- **WHEN** the user runs `reins spec`
- **THEN** the command lists `openspec/config.yaml`, `openspec/specs/**/spec.md`, and `openspec/changes/**/{proposal,design,tasks,spec}.md`
