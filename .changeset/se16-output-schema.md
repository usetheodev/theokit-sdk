---
"@theokit/sdk": minor
---

**SE16 — `outputSchema` on `defineTool` (validate + infer the tool's return).**

`defineTool` (from `@theokit/sdk`) gains an optional `outputSchema` (a Zod schema). When set, the handler returns the STRUCTURED output inferred from it (`z.infer<outputSchema>`), the value is validated against the schema, and the tool result becomes its serialization — a string stays as-is, an object is JSON-stringified. A validation failure raises `ZodError` (converted to a `tool_result(isError)`), so a malformed tool output fails loudly instead of silently reaching the model.

Additive + fully backward-compatible: with no `outputSchema` the handler returns a plain `string` exactly as before (the handler return type is `string` when `outputSchema` is absent, `z.infer<outputSchema>` when present, via a conditional type). Mirrors Mastra `createTool`'s `outputSchema`. Pairs with SE17 (`toModelOutput`). From the Mastra Tools comparison (SDK Evolution roadmap SE16).
