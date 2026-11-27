# Knowledge Studio Specification

## Purpose

Give a person one surface to see the knowledge tree the way the repository is shaped, create and edit nodes under the template, review proposals, and see where knowledge and code disagree. The studio writes files, never a database, and it never writes an accepted node on an agent's behalf.

## ADDED Requirements

### Requirement: Browse knowledge as a component tree

The system SHALL render the knowledge tree as layers, components, and nodes derived from directories, and SHALL hide guidance files, index files, and the template from node listings.

#### Scenario: Opening a repository with a tree

- **WHEN** the user opens the studio for a repository that has `.reins/knowledge/template.md`
- **THEN** the tree groups nodes by declared layer and then by component directory
- **AND** files whose stem starts with `_`, `template.md`, `index.yaml`, and `index.json` are absent from the node list

#### Scenario: Empty and unlayered directories

- **WHEN** a directory contains no node
- **THEN** the studio does not render it as a node
- **AND** a directory with an index file and no node renders as an empty component with a warning

### Requirement: Create and edit a node against the template

The system SHALL provide a node editor with a frontmatter form, a markdown body, and the template guidance, and SHALL validate before writing.

#### Scenario: Creating a node

- **WHEN** the user creates a node and submits it
- **THEN** the file is written under `.reins/knowledge/` at the chosen component with valid frontmatter
- **AND** `created` and `updated` are set to the current date
- **AND** the write is atomic and leaves no partial file

#### Scenario: Failing validation

- **WHEN** the node misses a required field or declares an undeclared layer
- **THEN** the studio shows the field error with the template rule it violates
- **AND** no file is written
- **AND** the editor keeps the user's content

#### Scenario: Editing a node

- **WHEN** the user saves an existing node
- **THEN** `updated` changes and the rest of the body is preserved byte for byte
- **AND** the studio shows the diff before the save is final

### Requirement: Show local guidance while authoring

The system SHALL show every inherited `_` guidance file for the node's directory and SHALL distinguish guidance from nodes.

#### Scenario: Authoring inside a component with rules

- **WHEN** the user edits a node under a component that has `_rules.md`
- **THEN** the studio shows the component guidance and the tree-wide guidance
- **AND** the guidance is marked as guidance, not as a node
- **AND** guidance files are not editable through the node form

### Requirement: Review a proposal before acceptance

The system SHALL show a proposed node in `inbox/` with its diff, its validation result, and its unresolved links, and SHALL require an explicit human action to accept it.

#### Scenario: Accepting a proposal

- **WHEN** the user accepts a proposal
- **THEN** the file moves from `inbox/` to its component directory
- **AND** `status` becomes `accepted` and `updated` changes
- **AND** the result is a Git diff the user can inspect
- **AND** the studio does not commit

#### Scenario: Rejecting a proposal

- **WHEN** the user rejects a proposal
- **THEN** `status` becomes `rejected`
- **AND** the file remains in `inbox/`

### Requirement: Show knowledge and code drift

The system SHALL show a coverage state per component and SHALL explain each state in text.

#### Scenario: A stale component

- **WHEN** a node in a component links a symbol that changed after the node's `updated` date
- **THEN** the component shows a stale state
- **AND** the detail names the node, the link, and the current span

#### Scenario: A code area with no node

- **WHEN** a code area has no accepted node and is not below the configured minimum size
- **THEN** the studio lists it as unmapped
- **AND** offers the bootstrap action for that area

### Requirement: Bootstrap a tree from an existing repository

The system SHALL generate a proposed tree from the Trail graph, SHALL preview it by default, and SHALL write only after an explicit confirmation.

#### Scenario: Previewing a bootstrap

- **WHEN** the user runs the bootstrap for a repository with a Trail graph
- **THEN** the studio lists every component and node it would create and every path it skipped, with a reason
- **AND** nothing is written until the user confirms

#### Scenario: Writing a bootstrap

- **WHEN** the user confirms the bootstrap
- **THEN** every created node has `status: proposed`
- **AND** a node body contains only observed facts, with a TODO marker for intent
- **AND** no file outside `.reins/knowledge/` changes
- **AND** no commit is made

#### Scenario: Missing graph

- **WHEN** the repository has no Trail graph
- **THEN** the bootstrap stops with an actionable message
- **AND** the studio does not build a graph on its own

### Requirement: Discuss a node

The system SHALL show the comment thread for a node and SHALL write a comment only after an explicit human action.

#### Scenario: Reading a thread

- **WHEN** the user opens a node that has comments in git notes
- **THEN** the studio lists each comment with author and timestamp
- **AND** a missing notes ref yields an empty thread, not an error

#### Scenario: Adding a comment

- **WHEN** the user submits a comment
- **THEN** the comment is appended to `refs/notes/reins` for the current commit
- **AND** the studio does not push or fetch Git refs
- **AND** a failure to write the git notes entry leaves the node and the editor untouched

### Requirement: Stay usable without the index or the network

The system SHALL keep authoring and browsing available offline and with the knowledge index absent.

#### Scenario: First query after clone

- **WHEN** the user opens the studio in a fresh clone with no `.reins/.cache/knowledge-index.json`
- **THEN** the studio builds the index from markdown and shows progress
- **AND** browsing and editing work before the build finishes

### Requirement: Keep large trees responsive

The system SHALL keep the tree interactive for trees up to 5,000 nodes.

#### Scenario: Expanding a large component

- **WHEN** the user expands a component in a tree of 5,000 nodes
- **THEN** the tree renders with virtualized rows
- **AND** the expansion completes without blocking input

#### Scenario: Keyboard use

- **WHEN** the user navigates the studio with a keyboard only
- **THEN** the tree, editor, validation panel, and thread are reachable in visual order
- **AND** every coverage dot has a text label

### Requirement: Apply a built-in knowledge template

The system SHALL ship built-in templates and SHALL keep an existing `template.md` instead of overwriting it.

#### Scenario: Listing templates

- **WHEN** the user runs `reinss knowledge init --list-templates`
- **THEN** the output names `default`, `minimal`, `c4`, and `domain` with a one-line purpose

#### Scenario: Applying the C4 template

- **WHEN** the user runs `reinss knowledge init --template c4`
- **THEN** `.reins/knowledge/template.md` declares context, container, component, code, ownership, and inbox layers
- **AND** the layer directories are created
- **AND** a later init keeps the existing template and reports it

### Requirement: Draft nodes with an opted-in model

The system SHALL draft nodes from code, specs, and requirements only when AI drafting is enabled, and SHALL write only proposed nodes.

#### Scenario: Disabled by default

- **WHEN** the user runs `reinss knowledge init --from-code --ai` without `llm.enabled`, a model, or an API key
- **THEN** the command exits `1` with `LLM_DISABLED`
- **AND** no network request is made

#### Scenario: Preview

- **WHEN** AI drafting is enabled and `--write` is absent
- **THEN** the command prints the prompt that would be sent and the prompt size
- **AND** no request is made and no file is written

#### Scenario: Writing drafts

- **WHEN** the user passes `--ai --write`
- **THEN** the prompt contains the planned components and excerpts from `openspec/` and README
- **AND** each returned draft is validated against the planned components and template layers
- **AND** every written node has `status: proposed` and `provenance.kind: agent`
- **AND** a human accepts each node before it becomes accepted

#### Scenario: Model failure

- **WHEN** the model request fails, times out, or returns unusable JSON
- **THEN** the command exits `1` with `LLM_FAILED`
- **AND** no node is written

### Requirement: Configure a local model from the desktop

The system SHALL discover loopback OpenAI-compatible providers, list their models, save the selection, and keep the rest of the config unchanged.

#### Scenario: Auto-discovery

- **WHEN** the user opens Settings and a local server is listening
- **THEN** the provider and its models are listed with the base URL
- **AND** choosing a provider fills the base URL and model
- **AND** probes time out in under a second each

#### Scenario: Saving

- **WHEN** the user saves AI settings
- **THEN** `.reins/config.json` gains the llm fields and keeps every other key
- **AND** an invalid URL is rejected before writing

#### Scenario: No key for a local endpoint

- **WHEN** the base URL is loopback
- **THEN** AI drafting works without an API key
- **AND** a non-loopback endpoint without a key reports `LLM_DISABLED`

### Requirement: Initialize knowledge from the desktop

The system SHALL provide an Initialize action in the Studio that applies a template, previews or writes a component plan, and can use the configured model.

#### Scenario: Preview

- **WHEN** the user chooses a template and presses Preview
- **THEN** the template is created if missing and the plan or prompt is shown
- **AND** no node is written

#### Scenario: Writing

- **WHEN** the user presses Initialize
- **THEN** the tree reloads with the new proposed nodes
- **AND** AI drafting writes only proposed nodes
