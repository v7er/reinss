# Review Workspace Specification

## Purpose

Review a change with structural diff, graph context, and governing knowledge in one layout, and turn a comment into a knowledge draft.

## Requirements

### Requirement: Share one selection across panes

The system SHALL show diff, graph context, and linked knowledge in one layout and SHALL share one selection across the three panes.

#### Scenario: Selecting a change

- **WHEN** the user selects a diff operation
- **THEN** the graph pane updates to the related node
- **AND** the knowledge pane updates to the linked notes

### Requirement: Comment on a change

The system SHALL attach comments to a structural change or a line and SHALL keep them in local state until the user exports them.

#### Scenario: Adding a comment

- **WHEN** the user comments on an operation
- **THEN** the comment is stored for the session
- **AND** the repository is not modified

### Requirement: Promote a comment to a knowledge draft

The system SHALL prefill type, links, file, and line when a comment becomes a knowledge draft and SHALL write it to the inbox.

#### Scenario: Promoting a comment

- **WHEN** the user promotes a comment
- **THEN** a draft note is created in `knowledge/inbox/`
- **AND** the draft includes the file, line, and diff context

### Requirement: Navigate by operation

The system SHALL move to the next and previous operation with the keyboard, not line by line.

#### Scenario: Moving to the next operation

- **WHEN** the user presses the next-operation shortcut
- **THEN** the selection moves to the next operation
- **AND** the panes update together

### Requirement: Show a change risk summary

The system SHALL count operations by type, touched surfaces, and constraints at risk.

#### Scenario: Opening a review

- **WHEN** the review loads
- **THEN** the summary shows counts by operation type
- **AND** the summary lists touched surfaces and constraints at risk
