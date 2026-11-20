# Embed API Specification

## Purpose

Ship every major view as a React component with an injected client, typed navigation events, and theme tokens, so a host can mount Reins without Node or Tauri.

## Requirements

### Requirement: Ship views as React components

The system SHALL provide every major view as a React component that accepts data or a client and SHALL NOT read files directly.

#### Scenario: Mounting a view in a plain React app

- **WHEN** a host renders a Reins view with a client
- **THEN** the view renders without Tauri or Node
- **AND** the view does not read the filesystem

### Requirement: Accept an injected client

The system SHALL accept a host-provided `ReinsClient` and SHALL treat the default client as optional.

#### Scenario: Supplying a custom transport

- **WHEN** the host supplies its own client
- **THEN** every view uses that client
- **AND** no view imports a transport directly

### Requirement: Emit navigation events

The system SHALL emit typed navigation targets through `onNavigate` and SHALL NOT force a route.

#### Scenario: Clicking a symbol without a handler

- **WHEN** the user clicks a symbol and no `onNavigate` handler exists
- **THEN** the app does not crash
- **AND** the selection remains visible

### Requirement: Support themes

The system SHALL support light, dark, and system themes through tokens and SHALL NOT hard-code a page background.

#### Scenario: Switching to dark mode

- **WHEN** the host selects the dark theme
- **THEN** every component uses dark tokens
- **AND** no component keeps a light page background

### Requirement: Provide a custom element wrapper

The system SHALL provide one custom element per major view with documented attributes and events.

#### Scenario: Mounting in a non-React host

- **WHEN** a non-React host mounts a custom element
- **THEN** the view renders
- **AND** navigation events are emitted as DOM events

### Requirement: Work inside a tldraw host

The system SHALL provide a documented example that mounts the components as shapes and SHALL NOT depend on tldraw at runtime.

#### Scenario: Mounting as a tldraw shape

- **WHEN** the example host mounts a Reins view as a shape
- **THEN** the view renders inside the shape
- **AND** Reins does not import tldraw
