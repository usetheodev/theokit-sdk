---
"@theokit/sdk-tools": minor
---

M3-5 — ACI description override + render `<tools>` (plan `m3-aci-tools`).

Two pure, zero-dependency ACI helpers in `@theokit/sdk-tools`:

- `withDescription(tool, description)` — returns a new `CustomTool` with the LLM-facing description replaced (name/inputSchema/handler preserved); the original tool is not mutated. Tune a built-in tool's wording without re-implementing it.
- `renderToolList(tools)` — renders a `<tools>` block (name + description per tool) from the SAME `CustomTool[]` the agent runs, so the list cannot drift from the real tools (single source of truth). XML-escaped, empty-safe (`<tools></tools>`), never throws. It is a system-prompt orientation aid — the provider schema stays each tool's `inputSchema`.

Zero new dependencies.
