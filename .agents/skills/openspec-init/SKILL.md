---
name: openspec-init
description: Initialize OpenSpec as the project knowledge base in a new project. Installs the CLI, runs openspec init, writes config.yaml and the first spec, and verifies Reins reads the files. Use when starting a project, or when a project has no openspec/ directory.
---

# openspec-init

OpenSpec is the first place a person or an agent looks before reading code. It holds the brief, requirements, technical decisions, and the task plan for each change.

## When to use

- A new project has no `openspec/` directory.
- An existing project has no OpenSpec and the human wants one.
- Do not use when `openspec/specs/` or `openspec/changes/` already has content. Extend that content instead.

## Inputs to confirm

1. The project root.
2. One sentence on what the project is for.
3. The commands that build, test, and run it.
4. Any constraint that must hold for every change.
5. Whether the workflow skills belong on this machine or in the repository.

If the human cannot state the project purpose, stop. An empty knowledge base is worse than none.

## Steps

1. Check the target.

   ```bash
   test -d openspec && echo "exists" || echo "missing"
   openspec --version
   ```

   If `openspec/` exists with specs or changes, stop and extend it. Do not overwrite.

2. Install the CLI when missing. Ask before a global install.

   ```bash
   npm install -g @fission-ai/openspec@latest
   ```

   Node 22.20 or newer is required. Homebrew is an alternative on macOS: `brew install openspec`.

3. Initialize at the project root.

   ```bash
   openspec init
   ```

   Use `openspec init --scope project` when the skills must be committed with the repository. Use `openspec init --tools none` when only the `openspec/` structure is wanted.

4. Write `openspec/config.yaml`. Keep it short. It reaches every artifact.

   ```yaml
   schema: spec-driven
   context: |
     <one paragraph: what this project is, who it serves, what it refuses to do>
     Commands: <build>, <test>, <run>
     Constraints: <the rules every change must follow>
   ```

   Put artifact-specific guidance under `rules`, and apply or archive guidance under `operations`. Do not paste the whole README.

5. Seed the first spec at `openspec/specs/<capability>/spec.md`. Use the current behavior, not the planned work.

   ```markdown
   # <Capability> Specification

   ## Purpose

   One or two sentences on what this capability is for.

   ## Requirements

   ### Requirement: <name>

   The system SHALL <observable behavior>.

   #### Scenario: <name>

   - **WHEN** <condition>
   - **THEN** <outcome>
   ```

   One behavior per requirement. Every requirement needs at least one scenario. Use `SHALL` or `MUST`, not `should` or `may`.

6. Create the first change when the human has a concrete next step.

   ```text
   openspec/changes/<change>/
   ├── proposal.md    why and what changes
   ├── specs/<capability>/spec.md   ADDED or MODIFIED requirements
   ├── design.md      technical decisions, only when needed
   └── tasks.md       implementation checklist
   ```

   The proposal names the capabilities. Each capability gets one delta spec. A change with no behavior change sets `skip_specs: true` in `.openspec.yaml`.

7. Validate.

   ```bash
   openspec validate --all --strict
   ```

   Fix structural errors. A warning about a missing scenario or a long requirement is a real defect in the knowledge base.

8. Verify Reins reads the files.

   ```bash
   reins spec
   reinss ask "openspec"
   ```

   `reins spec` lists `openspec/config.yaml`, `openspec/specs/**/spec.md`, and `openspec/changes/**/{proposal,design,tasks,spec}.md`. `reinss ask "openspec"` searches them with `source: openspec`.

## Stop conditions

- `openspec/` already has specs or changes. Extend it, do not reinitialize.
- The CLI cannot be installed and the human declines a fallback.
- The project purpose or commands are unknown. Ask, do not invent.
- A spec would describe planned behavior that does not exist yet. Put it in a change, not in `openspec/specs/`.

## Output

- The `openspec/` tree with `config.yaml`, at least one spec, and optionally one change.
- The exact validation command and its result.
- The exact Reins commands and their result.
- What was not migrated from the old documents.

## Failure modes

- **Copying a template.** A spec full of placeholders teaches the next agent nothing. Write the real behavior or leave the file out.
- **Spec as design.** Library choices and function names belong in `design.md`, not in a requirement.
- **One giant capability.** Split by durable system behavior, not by task or by folder.
- **Writing accepted specs from an agent's guess.** The human reviews the first spec before it becomes the source of truth.
