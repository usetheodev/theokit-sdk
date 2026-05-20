# generateObject Real-LLM Validation — 2026-05-17T18:46:16.026Z

Acceptance rubric (ADR D33): `Agent.generateObject` MUST return a Zod-parsed
object via the synthetic forced-tool path, with NO transient-agent leak.

## Configuration

- Provider: OpenRouter
- Model: google/gemini-2.0-flash-001
- Schema: `{ title, summary, year (int|null), sources[1..3] }`
- Workspace: /tmp/genobj-real-g5XUzQ
- maxRetries: 2

## Result

| # | Check | Pass |
|---|---|---|
| 1 | object is present | ✅ |
| 2 | object.title non-empty | ✅ |
| 3 | object.summary >= 10 chars | ✅ |
| 4 | object.year is int|null | ✅ |
| 5 | object.sources is array with 1..3 | ✅ |
| 6 | raw is non-undefined (model called tool) | ✅ |
| 7 | finishReason === 'tool_use' | ✅ |
| 8 | registry leak == 0 (transient deleted) | ✅ |

- Elapsed: 1943ms
- finishReason: `tool_use`
- usage: `{ inputTokens: 0, outputTokens: 0 }`

## Generated object

```json
{
  "title": "Eiffel Tower",
  "summary": "The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars in Paris, France. It is named after the engineer Gustave Eiffel, whose company designed and built the tower.",
  "year": 1889,
  "sources": [
    "https://en.wikipedia.org/wiki/Eiffel_Tower"
  ]
}
```

## Verdict

**PASS** — 8/8 checks passed.

This validation proves `Agent.generateObject` works end-to-end against a real
LLM (not fixture mode). The Zod parse + synthetic forced-tool design produced
a schema-valid object on the first try.
