# Semantic Diff Specification

## Purpose

Describe a change by structure, not line noise, and produce a deterministic result that a person or an agent can review.

## Requirements

### Requirement: Parse both sides of a change

The system SHALL parse both sides with a structural parser for TypeScript and JavaScript and SHALL degrade to a line diff with an explicit reason for other languages.

#### Scenario: Parsing TypeScript

- **WHEN** both sides are TypeScript
- **THEN** the diff uses the structural parser
- **AND** the result includes semantic operations

#### Scenario: Degrading an unsupported language

- **WHEN** a file cannot be parsed
- **THEN** the file is marked `degraded: true`
- **AND** the result includes the reason and a line diff

### Requirement: Detect moves

The system SHALL report a definition with an identical normalized subtree at a different path or position as `moved`, not as delete plus add.

#### Scenario: Moving a function

- **WHEN** a function moves to another file with the same body
- **THEN** the result contains one `moved` operation
- **AND** the old and new locations are recorded

### Requirement: Detect renames

The system SHALL report a definition whose subtree is equal but whose name changed as `renamed` with old and new names.

#### Scenario: Renaming a function

- **WHEN** a function keeps its body and changes its name
- **THEN** the result contains one `renamed` operation
- **AND** the operation records both names

### Requirement: Detect real edits

The system SHALL report changed bodies as `modified` with before and after spans and a compact token summary.

#### Scenario: Editing a function body

- **WHEN** a function body changes
- **THEN** the result contains a `modified` operation
- **AND** the operation includes both spans

### Requirement: Detect reformat-only changes

The system SHALL report equal token streams with different whitespace, comments, or line breaks as `reformatted`, never `modified`.

#### Scenario: Reformatting a file

- **WHEN** only whitespace or comments change
- **THEN** the result contains `reformatted`
- **AND** the result does not contain `modified` for that definition

### Requirement: Detect extraction and inlining

The system SHALL report a new function whose body came from the old body with the old site calling it as `extracted`, and the reverse as `inlined`, both with confidence.

#### Scenario: Extracting a helper

- **WHEN** a function body moves into a new helper and the old site calls it
- **THEN** the result contains `extracted`
- **AND** the operation includes confidence and evidence

### Requirement: Produce deterministic JSON

The system SHALL produce byte-identical JSON for the same inputs, parser versions, and options after key ordering.

#### Scenario: Repeating a diff

- **WHEN** the same diff runs twice
- **THEN** the JSON output is byte-identical

### Requirement: Show a structural diff view

The system SHALL group operations by file, reveal before and after for a selected operation, and show a line-level unified diff computed from both sources.

#### Scenario: Selecting an operation

- **WHEN** the user selects an operation
- **THEN** the code panel shows the before and after spans
- **AND** the line diff uses `+` and `-` markers from both sources

### Requirement: Support Git ranges

The system SHALL support working tree, staged, commit range, and branch versus base, and SHALL report the resolved commit SHAs.

#### Scenario: Diffing a commit range

- **WHEN** the user selects a commit range
- **THEN** the result reports the resolved SHAs
- **AND** the diff covers only that range

### Requirement: Support watch mode

The system SHALL update only the changed file's result within 500 ms of a save and SHALL keep the view scroll position.

#### Scenario: Saving a file

- **WHEN** a file changes while watch mode is on
- **THEN** only that file's result updates
- **AND** the scroll position is preserved

### Requirement: Link a changed symbol

The system SHALL open the graph centered on a changed symbol or the surface that reaches it.

#### Scenario: Opening a changed symbol in the graph

- **WHEN** the user activates a changed symbol
- **THEN** the graph opens centered on that node
- **AND** the selection matches the symbol
