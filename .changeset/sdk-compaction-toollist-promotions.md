---
"@theokit/sdk": minor
"@theokit/sdk-tools": minor
---

@theokit/sdk: `shouldCompact`/`ShouldCompactInput` gains an optional `maxOutput` output-reserve term (`estimated >= contextWindow - buffer - (maxOutput ?? 0)`), defaulting to today's behavior. @theokit/sdk-tools: `renderToolList` gains an optional `{ mode: "full" | "summary" | "names" }` — `"full"` (default) is the existing `<tools>` XML; `"summary"` renders `- name: <first sentence>`; `"names"` renders `- name`.
