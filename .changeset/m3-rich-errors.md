---
"@theokit/sdk-tools": minor
---

M3-4 — rich tool errors / self-correction guidance (plan `m3-rich-errors`).

`@theokit/sdk-tools` now exports a composable wrapper that adds an LLM-actionable `guidance` hint to a failing tool result so the model can self-correct:

- `withToolResultGuidance(tool, guidance)` — wraps any `CustomTool`; on an `{ ok:false, error }` result it adds a `guidance` string from the `guidance` map (keyed by error code), preserving name/description/inputSchema.
- `withDefaultGuidance(tool)` — pre-bound to `DEFAULT_TOOL_GUIDANCE`, a curated map for the common codes (`not_found`, `path_traversal`, `forbidden_path`, `no_match`, `no_matches`, `timeout`, `ssrf_blocked`, `catastrophic_command`, `binary_file`, `too_large`).
- `injectGuidance(output, guidance)` — the pure underlying transform.

Injection is ADDITIVE (only on `ok:false`), IDEMPOTENT (never overwrites existing `guidance`), and NEVER-THROW: non-JSON output, `ok:true`, non-object JSON, or an unknown code is returned unchanged. Compose over the built-in tools or your own — no factory edits. Zero new dependencies.
