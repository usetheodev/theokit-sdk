---
"@theokit/sdk": minor
"@theokit/sdk-tools": minor
---

@theokit/sdk: `shouldCompact`/`ShouldCompactInput` gains an optional `maxOutput` output-reserve term (`estimated >= contextWindow - buffer - (maxOutput ?? 0)`), defaulting to today's behavior. `AgentOptions.plugins` now also accepts an array of code `Plugin` objects (matching the runtime + docs), not only `{ enabled }`. @theokit/sdk-tools: `renderToolList` gains an optional `{ mode: "full" | "summary" | "names" }` — `"full"` (default) is the existing `<tools>` XML; `"summary"` renders `- name: <first sentence>`; `"names"` renders `- name`.
