# Surfaces Specification

## Purpose

Find the entry points users reach, link them to graph nodes, and trace the handler path from a route, command, page, or screen.

## Requirements

### Requirement: Discover HTTP and CLI surfaces

The system SHALL detect HTTP and CLI entry points for supported frameworks and SHALL report framework, method, route, handler symbol, file, line, and confidence.

#### Scenario: Detecting an Express route

- **WHEN** the repository contains an Express route
- **THEN** the surface includes the HTTP method, route, handler symbol, file, line, and confidence

#### Scenario: Detecting a Commander command

- **WHEN** the repository contains a Commander command
- **THEN** the surface includes the command name, handler symbol, file, line, and confidence

### Requirement: Discover pages and screens

The system SHALL detect page and screen entry points for supported frameworks and SHALL report the route, component file, and component symbol when resolvable.

#### Scenario: Detecting a Next.js page

- **WHEN** the repository contains a Next.js App Router page
- **THEN** the surface includes the route and the component file
- **AND** the component symbol is included when it resolves

#### Scenario: Detecting a React Router route

- **WHEN** the repository contains a React Router route
- **THEN** the surface includes the route and the component file

### Requirement: Link surfaces to graph nodes

The system SHALL set `symbolId` to a real Trail node ID or `null` with a reason and SHALL NOT invent IDs.

#### Scenario: Unresolved handler

- **WHEN** a surface handler cannot be matched to a Trail node
- **THEN** `symbolId` is `null`
- **AND** the surface includes a reason

### Requirement: List and filter surfaces

The system SHALL filter surfaces by kind, framework, path, and confidence and SHALL report exact counts for the current filter.

#### Scenario: Filtering by framework

- **WHEN** the user filters by framework
- **THEN** only matching surfaces are returned
- **AND** the count matches the filtered set

### Requirement: Trace a flow from a surface

The system SHALL trace route to handler to callees in one view with the same depth and confidence controls as the graph.

#### Scenario: Tracing a route

- **WHEN** the user opens a surface flow
- **THEN** the view starts at the surface handler
- **AND** the view shows callees to the selected depth

### Requirement: Honor OpenAPI documents

The system SHALL import routes from OpenAPI or Swagger documents when present, mark them `source: openapi`, and deduplicate them against code-detected routes. An `x-source-file` value MAY name a handler symbol with `@function` or `@Class:method`; a class-only `@Class` SHALL trace constructor-injected classes one level out.

#### Scenario: Importing an OpenAPI route

- **WHEN** an OpenAPI document declares a route that code also detects
- **THEN** the route appears once
- **AND** the imported source is recorded

### Requirement: Add a detector without touching the engine

The system SHALL support a new detector as a separate module with a fixture and one registry entry.

#### Scenario: Registering a detector

- **WHEN** a detector module is added and registered
- **THEN** its fixture produces surfaces
- **AND** the engine code does not change

### Requirement: Discover package exports

The system SHALL list exported symbols from workspace packages and their consumers.

#### Scenario: Listing package exports

- **WHEN** the user opens package exports
- **THEN** the view lists exported symbols and the packages that consume them
