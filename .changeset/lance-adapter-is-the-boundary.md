---
"@theokit/sdk": patch
---

Removed `LanceMemoryAdapter.unwrap()`, which handed callers the raw `LanceIndex`
behind the adapter. It had no callers anywhere in the monorepo — including the
migration tool and benchmark script its own docblock named, both of which open a
`LanceIndex` directly and never go through the adapter.

A caller that needs `addFacts` / `countFacts` / `removeFacts` needs a
`LanceIndex`, and opening one is the honest way to get it.
