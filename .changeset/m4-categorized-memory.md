---
"@theokit/sdk-memory": minor
---

M4-3 — typed categorized memory store (plan `m4-categorized-memory`).

- `createCategorizedMemory({ root, categories })` — a typed, category-partitioned markdown memory store. `add(category, text)` validates `category` against the closed `categories` taxonomy (fail-loud `ConfigurationError(code: "unknown_category")` before any I/O), redacts secrets, and appends a bullet to `<root>/<category>.md` (frontmatter header + `## Facts`) atomically and serialized per category file (`withCwdMutex` — no lost update under concurrent adds). `list(category?)` returns `CategorizedFact[]` for one category or all; never throws (a missing file → no facts). Construction validates the taxonomy is non-empty, unique, sanitizable, and sanitized-unique.
- `MemoryFact` gains an optional `category?: string` (backward-compatible — flat-store facts omit it).

Composes the shipped `safePathJoin`/`sanitizeIdentifier` (`@theokit/sdk/path-safety`), `redactSecrets`, and `replaceFileAtomic`/`withCwdMutex` (`@theokit/sdk/internal/persistence`). Zero new dependencies — explicitly NOT adding `zod` (the closed `categories` set is the runtime-checked schema).
