---
"@theokit/sdk": minor
---

**SE7 — structured/multimodal tool results + `ToolError`.**

A tool can now hand the model structured content (text + image) as its result OR its error, not just a string — symmetrically. A `handler` may RETURN content blocks on success, and may THROW a `ToolError` carrying content blocks on failure (e.g. a screenshot, a rendered chart). Additive + backward-compatible: returning/throwing a string is unchanged.

- New types `ImageBlock` + `ToolResultContentBlock = TextBlock | ImageBlock`; new `ToolError` class carrying `string | ToolResultContentBlock[]` (throw it from a handler for a clean message or multimodal error content).
- `CustomTool.handler` return widened to `string | ToolResultContentBlock[]`.
- **Provider-agnostic, capability-based:** block-capable provider wires forward the blocks natively; string-only provider wires flatten text-only blocks to a string and **fail fast** with a typed `ConfigurationError` on an image block (no silent drop — a dropped image would be a lie to the model, per the error-handling policy).
- Persistence/replay (event-based) is untouched; the tool-result guard still redacts/delimits the text of a structured result (image blocks pass through).

New exports: `ToolError`, `ImageBlock`, `ToolResultContentBlock`. Proven end-to-end by an integration test (a handler-returned image, and a `ToolError`'s image, both carried onto the outbound `tool_result`).

Grounded in the SDK Evolution roadmap SE7.
