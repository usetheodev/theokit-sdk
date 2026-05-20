# D81 — `sanitizeIdentifier` accepts `^[a-z0-9][a-z0-9-_]*$`

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D79, plan `security-block-completion-plan.md`

## Decision

`sanitizeIdentifier(input, { maxLen = 64 })`:

- Length must be 1..maxLen.
- Pattern `^[a-z0-9][a-z0-9-_]*$` (case-insensitive on input).
- Returns `input.toLowerCase()` on success.
- Throws `ConfigurationError(code: "invalid_identifier")` on failure.

Rejected: `.`, `/`, `\`, ` `, `\0`, unicode invisible chars, anything
beginning with `-` or `_`.

## Rationale

- First-char rule prevents `--foo` identifiers that could mimic CLI
  flags in shell-like contexts.
- No `.` defeats `..` traversal at the grammar layer.
- No `/` or `\` defeats path traversal via embedded separator.
- Strict alphanumeric + dash/underscore is what every other usetheo
  product (skill names, agent IDs) already uses — relaxing later is
  trivial; tightening later breaks users.

Audit (T3.2b, 2026-05-19) against real `.theokit/agents/registry.json`
files in dev local + telegram-pro confirms 0 legacy IDs violate this
grammar.

## Consequences

- **Enables:** safe path joins where the identifier becomes a path
  segment.
- **Constrains:** future agent ID schemes must obey the grammar. UUIDs,
  hash IDs, and `agent-<uuid>` / `bc-<uuid>` formats all pass natively.
