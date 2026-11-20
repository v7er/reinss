# Code Graph Specification

## Purpose

Answer structural questions about symbols, callers, callees, and blast radius from the Trail graph without reading whole files.

## Requirements

### Requirement: Search symbols

The system SHALL search symbols by name, qualified name, or plain query and SHALL return node ID, kind, path, line range, and a stable rank.

#### Scenario: Searching by name

- **WHEN** the user searches for a symbol name
- **THEN** results include the Trail node ID, kind, path, and line range
- **AND** equal scores sort deterministically

#### Scenario: Empty query

- **WHEN** the query is empty
- **THEN** the result is an empty list, not an error

### Requirement: Show callers and callees

The system SHALL return callers and callees for a symbol with depth 1 to 5 and direction `in`, `out`, or `both`.

#### Scenario: Finding callers

- **WHEN** the user requests callers at depth 1
- **THEN** every row includes `path:line` and the Trail node ID
- **AND** the result states the direction and depth used

#### Scenario: Rejecting an unsupported depth

- **WHEN** the requested depth is outside 1 to 5
- **THEN** the request fails with a validation error
- **AND** the error names the allowed range

### Requirement: Show a blast radius

The system SHALL walk transitively from a symbol or diff with a node cap, a depth cap, a `truncated` flag, and deterministic ordering.

#### Scenario: Truncating a large blast radius

- **WHEN** the walk reaches the node cap
- **THEN** the result sets `truncated: true`
- **AND** the result names what was cut

### Requirement: Render the graph interactively

The system SHALL render a graph that supports pan, zoom, select, one-hop expand, and opening a node's source range.

#### Scenario: Expanding one hop

- **WHEN** the user expands a selected node
- **THEN** the view adds that node's immediate neighbors
- **AND** the layout is deterministic for the same input

### Requirement: Filter the graph

The system SHALL filter by language, package, directory, and relation kind before layout and SHALL show the visible count.

#### Scenario: Applying a filter

- **WHEN** the user filters by directory
- **THEN** only matching nodes and their allowed edges are laid out
- **AND** the visible count updates

### Requirement: Offer a large-graph mode

The system SHALL switch to an aggregated or canvas renderer above 1,500 visible nodes without freezing the UI.

#### Scenario: Crossing the large-graph threshold

- **WHEN** the visible node count exceeds 1,500
- **THEN** the view uses the large-graph renderer
- **AND** the UI remains responsive

### Requirement: Pin and compare graph slices

The system SHALL render two graph slices side by side with independent selection.

#### Scenario: Comparing two slices

- **WHEN** the user pins a slice and opens a second one
- **THEN** both slices render side by side
- **AND** selecting a node in one slice does not change the other
