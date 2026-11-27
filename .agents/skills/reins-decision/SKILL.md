---
name: reins-decision
description: Use when a durable decision, constraint, or "how we build here" rule is made, or when a constraint is discovered in code. Produces a proposed markdown node in the knowledge inbox with verified links, for human acceptance. Never writes accepted nodes directly.
---

# reins-decision

Capture intent so the next session does not rediscover it. A decision node records why, not what the code already says.

## When to use

- A choice was made that future work must follow: a boundary, a dependency rule, a data shape, a process.
- A constraint was discovered: "this must never call that", "this file must stay pure", "this endpoint must be idempotent".
- A repeated explanation happened twice in one session. That is a signal it belongs in the ledger.

Do not use for:

- A task status update or a changelog entry.
- A restatement of what a function does.
- A question that is still open. Use type `question` instead.
- A decision the human has not agreed to.

## Inputs to confirm

1. The repository has `.reins/knowledge/`, or the human wants to start it.
2. The decision is stable enough to write down.
3. The symbols or surfaces it applies to, with real IDs from the graph.
4. Whether an existing node already covers it.

## Steps

1. Search for an existing node.

   ```bash
   reinss ask "<subject>"
   ```

   Before Phase 4, use `grep -r "<subject>" .reins/knowledge/` and read the matching files.

   If a node exists, propose an edit or a superseding node. Do not create a duplicate.

2. Choose the type.

   | Type | Use when |
   | --- | --- |
   | `decision` | A choice with alternatives and consequences. |
   | `constraint` | A rule that can be checked against a change. |
   | `spec` | What a feature must do, with acceptance criteria. |
   | `howto` | A repeatable procedure specific to this repository. |
   | `question` | An open question with an owner and a decision date. |

3. Verify every link before writing it.

   ```bash
   trail callers <symbol> --json --depth 1
   trail skeleton <file> --json
   ```

   Use the exact Trail node ID (`path#name`). Do not invent an ID. If a surface ID is not known yet, leave the link out and note it in the body.

4. Draft the node with the schema in `docs/03-data-contracts.md` section 7. Required fields: `title`, `type`, `status: proposed`, `created`, `updated`. Recommended body sections for a decision: `Decided`, `Context`, `Ruled out`, `Consequences`, `Watch out`.

5. Write to the inbox only.

   ```text
   .reins/knowledge/inbox/<id>.md
   ```

   The id is the filename stem: lowercase, hyphens, 2 to 64 characters. Never write to `decisions/`, `constraints/`, or any accepted folder.

6. Show the human:

   - the file path and the full diff,
   - every link and whether it was verified,
   - any link you could not verify,
   - one sentence on what would make this node wrong.

7. Ask for acceptance. Acceptance is a human action: move the file to the type folder, set `status: accepted`, update `updated`. Do not do it yourself unless the human explicitly asks in this session.

## Stop conditions

- The decision is not stable or the human disagrees with the wording.
- The same node already exists and the human has not chosen between edit and supersede.
- A symbol link cannot be verified and the node depends on it.
- The node would need a new required field or a new link relation. That is a schema change, not a node.

## Output

- One proposed node under `inbox/`.
- A diff.
- A list of verified and unverified links.
- A request for acceptance.

## Failure modes

- **Restating code.** "The refund function calls the ledger" is not a decision. "Refunds write to the ledger before the gateway, because a gateway outage must not leave the ledger wrong" is.
- **Link sprawl.** Link the one symbol or surface the node constrains, not every file in the area.
- **Silent acceptance.** An agent that moves its own proposal into `decisions/` has bypassed the review gate.
- **Constraint without a check.** If the node says "never", either give it a `rule` the checker can evaluate or write it as a decision and say it is reviewed by humans.
