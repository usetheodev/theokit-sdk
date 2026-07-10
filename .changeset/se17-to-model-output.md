---
"@theokit/sdk": minor
---

**SE17 — `toModelOutput` on `defineTool` (model-facing vs app-facing output split).**

`defineTool` (from `@theokit/sdk`) gains an optional `toModelOutput`. The handler returns the FULL result (validated by SE16's `outputSchema`); `toModelOutput(output)` maps it to the compact / multimodal representation the MODEL sees in the `tool_result` — so rich app-facing detail is not forced into model context. It returns a `string` OR SE7 `ToolResultContentBlock[]` (text + image). Absent ⇒ the tool result is the serialized handler output (SE16 / pre-SE17 behavior, unchanged).

Mirrors a peer framework's `toModelOutput` and the a peer framework. Additive + backward-compatible. From the a peer framework Tools comparison (SDK Evolution roadmap SE17).
