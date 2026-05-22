# D229 — Empty / null `inputJson` accepted when `inputType === undefined`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Parsing logic for handoff tool args:

- If `Handoff.options.inputType` is **undefined**: skip parsing entirely;
  `onHandoff(ctx, undefined)` fires.
- If `inputType` is **defined** AND raw input is empty/null/undefined: parse
  `{}` BEFORE Zod schema (Zod refinements for required fields still apply
  normally).
- If `inputType` is defined AND raw input is a valid JSON string: Zod-parse
  as usual.

## Rationale

- Some LLM providers omit the JSON args field when the input schema is empty
  (`z.object({})`). OpenAI Agents handles this transparently.
- Defaulting to `{}` lets the schema's normal validation fire (required
  fields still throw); strict-mode without an escape hatch breaks
  cross-provider portability.

## Consequences

- Enables cross-provider portability for empty-payload handoffs.
- Constrains: handoffs requiring fields (Zod `min(1)` etc) still throw on
  empty input; "required" semantics are caller's responsibility via schema.
