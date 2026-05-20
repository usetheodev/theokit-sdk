# streamObject Real-LLM Validation — 2026-05-17T21:27:18.493Z

Acceptance rubric (ADR D39): `Agent.streamObject` MUST emit exactly one
`complete` event with a Zod-parsed object, NO transient agent leak. Partials
are best-effort (provider-dependent).

## Configuration

- Provider: OpenRouter
- Model: google/gemini-2.0-flash-001
- Schema: `{ title, summary, year (int|null), sources[1..3] }`
- Workspace: /tmp/streamobj-real-i7M77t
- maxRetries: 2

## Result

| # | Check | Pass |
|---|---|---|
| 1 | stream finished without error | ✅ |
| 2 | complete event emitted | ✅ |
| 3 | complete.object schema-valid | ✅ |
| 4 | complete.finishReason === tool_use | ✅ |
| 5 | complete.raw non-undefined | ✅ |
| 6 | registry leak == 0 | ✅ |

- Partials emitted: 0
- Elapsed: 2327ms
- finishReason: `tool_use`

## Generated object

```json
{
  "title": "Great Wall of China",
  "summary": "The Great Wall of China is a series of fortifications that were built across the historical northern borders of ancient Chinese states and Imperial China as protection against nomadic groups from the Eurasian Steppe. ",
  "year": null,
  "sources": [
    "https://en.wikipedia.org/wiki/Great_Wall_of_China"
  ]
}
```

## Verdict

**PASS** — 6/6 checks passed.

Note: Gemini via OpenRouter typically batches tool_use output, so zero
partial events is expected; `complete` is the load-bearing event. The
contract is: ≥1 complete event, schema-valid, zero registry leak.
