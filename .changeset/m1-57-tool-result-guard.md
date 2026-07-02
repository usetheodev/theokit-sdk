---
"@theokit/sdk": minor
---

Add an opt-in tool-result content guard against prompt injection and PII leakage (#57). Tool results are untrusted input to the model; the new guard runs at the `transform_tool_result` seam before results reach the LLM. Enable it via `toolResultGuard`: `{ delimit: true }` frames tool output in explicit `<untrusted-tool-output>` data boundaries ("spotlighting") so the model treats it as data rather than instructions — a forged closing boundary inside the content is neutralized so it cannot break out of the frame; `{ redactPii: true }` replaces email/phone PII with `[REDACTED]`. Both are opt-in and non-breaking (undefined = unchanged behavior). The `defineTool` / `CustomTool` handler type is also widened to accept the optional `ToolContext` 2nd argument (completing the #65 wiring): single-argument handlers are unaffected.
