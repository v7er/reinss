# Repository Session Specification

## Purpose

Open a local repository, detect the Trail graph, report freshness, and build only when the user asks.

## Requirements

### Requirement: Open a local repository

The system SHALL open a local folder or Git repository, validate it, and persist it as the last repository.

#### Scenario: Reopening the last repository

- **WHEN** the user launches the app after opening a repository
- **THEN** the app reopens that repository
- **AND** the repository path is stored in local session state, not in the repository

#### Scenario: Rejecting an invalid folder

- **WHEN** the selected folder is not a readable directory
- **THEN** the app reports the failure and keeps the previous repository open

### Requirement: Detect Trail and graph state

The system SHALL report one graph state from `ready`, `missing-trail`, `missing-graft`, `stale`, and `unsupported-version`, with the detected versions.

#### Scenario: Reporting a ready graph

- **WHEN** Trail is installed and the graph is in sync
- **THEN** status reports `ready`
- **AND** status includes the Trail version and the graph freshness

#### Scenario: Reporting a missing graph

- **WHEN** Trail is installed but `graft/` is absent
- **THEN** status reports `missing-graft`
- **AND** the app offers an explicit build action

### Requirement: Build only on explicit action

The system SHALL run `trail build` only after an explicit user action and SHALL stream progress and the Trail error verbatim.

#### Scenario: Building from the UI

- **WHEN** the user activates the build action
- **THEN** the app runs `trail build`
- **AND** progress is visible until the command exits
- **AND** a failure shows the Trail error text

#### Scenario: No silent build

- **WHEN** the app opens a repository with a missing or stale graph
- **THEN** the app does not start a build
- **AND** the app shows the state and the build action

### Requirement: Report a stale graph

The system SHALL include graph freshness in every graph-backed answer and SHALL show a stale banner with a refresh action.

#### Scenario: Answering from a stale graph

- **WHEN** the graph is stale and the user requests callers
- **THEN** the result includes `graph.inSync: false`
- **AND** the UI shows the stale banner
- **AND** the answer is not presented as current

### Requirement: Remember recent repositories

The system SHALL keep a recent list of up to five repositories and SHALL persist layout per repository path.

#### Scenario: Switching repositories

- **WHEN** the user opens a repository that is already in the recent list
- **THEN** the repository moves to the front
- **AND** the previous layout for that path is restored

### Requirement: Support a monorepo

The system SHALL filter symbols and surfaces by path prefix and SHALL NOT assume a single package.

#### Scenario: Filtering to one package

- **WHEN** the user sets a path prefix
- **THEN** symbol and surface results are limited to that prefix
- **AND** the visible count reflects the filter
