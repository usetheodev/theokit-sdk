# Backlog

Items that are referenced in documentation but not yet implemented. Each item lists where it is referenced and the trigger for promoting it to active work.

Anything listed here MUST also have a hedge in its source reference (e.g., "(when/if implemented)") so a reader does not interpret it as a working feature.

## Skills / commands

### `/audit-rotate`

- **Type:** skill or shell command (TBD).
- **Source reference:** `rules/audit-trail-rotation.md` § Rotation triggers.
- **What it would do:** automate the manual sweep described in `audit-trail-rotation.md` — move merged `agents/{review,implement}-*` dirs older than 30 days into `agents/archive/`, summarize implementation iter logs, prune `.compaction-snapshots/` beyond the rolling-10 window.
- **Promotion trigger:** when `agents/` and `knowledge-base/implementations/` cross 50 dirs combined, manual sweep becomes painful enough to justify automation.
- **Open questions:** dry-run mode default? CI vs interactive? per-cycle policy override?

## Hooks

(none currently)

## Cycles / rules

(none currently)

## Promotion process

1. Open a `/grill-me {item-slug}` to surface constraints.
2. Run `/to-plan` once requirements are precise.
3. When the item ships, remove its entry from this file and update the source reference to remove the "(when/if implemented)" hedge.
