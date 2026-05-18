# D72 — `codeFile: true` opt-out for prefix-shaped content

**Date:** 2026-05-18
**Status:** Accepted
**Related:** D68, D71, plan `secret-redaction-discipline-plan.md`

## Decision

`redactSecrets(text, { codeFile: true })` runs the same 12 builtin
patterns but skips `PARAM_PATTERN` and `BEARER_PATTERN`. Files with
legitimate placeholder content like `.env.example`, JSON schema, or
test fixtures with hardcoded test keys can be passed through the
redactor without mangling the placeholders.

```typescript
// File: .env.example
OPENAI_API_KEY=sk-yourkeyhere
```

```typescript
redactSecrets(content, { codeFile: true });
// → "OPENAI_API_KEY=sk-yourkeyhere"  (preserved)

redactSecrets(content, { codeFile: false });
// → "OPENAI_API_KEY=***"  (PARAM_PATTERN fires on OPENAI_API_KEY=)
```

## Rationale

Hermes shipped v0.12 with redaction OFF citing this exact false
positive: patches that touched `.env.example` were corrupted by
aggressive redaction. v0.13 introduced the `code_file` opt-out. Same
trade-off applies here — the rare legitimate placeholder case is
recognized by the caller (file reader, schema editor) and explicitly
asks for the lenient mode.

Why pattern-by-pattern instead of file-globbed?

- The caller knows whether their input is a code file (they're the
  reader); the redactor doesn't.
- Default behavior stays aggressive; opt-out is explicit.

## Consequences

- Enables file-handling callers (future file-read/write tools, schema
  validators) to invoke `redactSecrets` without breaking placeholder
  text.
- Constrains: caller responsibility — pass `codeFile: true` only when
  the content is structurally a code/example file. Defaulting to
  `codeFile: true` everywhere would re-create the v0.12 incident.
- Constrains: the 12 builtin pattern matches still fire in `codeFile`
  mode. A `.env.example` containing a real 40-char OpenAI key WILL be
  masked. This is correct — placeholders use short stand-ins
  (`sk-yourkeyhere`), not full-length keys.
