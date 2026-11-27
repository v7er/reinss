# Knowledge template

Knowledge lives next to the code. One markdown node per intent. The directory that contains a node is its component or boundary. Files whose stem starts with `_` are guidance for humans and agents, never nodes.

## Layers

| Layer | Glob | Purpose |
| --- | --- | --- |
| product | `product/**` | Product intent and requirements |
| component | `components/**` | One directory per code component, boundary node first |
| inbox | `inbox/**` | Proposals waiting for a human decision |

## Required fields

title, type, status, created, updated

## Naming

- Node files: lowercase kebab case, 2 to 64 characters.
- Components: match the code directory they cover; set `code` in frontmatter when the names differ.
- Guidance files start with `_` and never appear as nodes.

## Rules

1. A component node states the contract, not the implementation.
2. A decision names what was ruled out and why.
3. Link the code you mean. A link that cannot resolve is a defect.
4. An agent proposes; a human accepts. Proposals live in `inbox/` with `status: proposed`.
