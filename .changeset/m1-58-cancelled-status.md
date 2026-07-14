---
"@theokit/sdk": patch
---

Fix (#58) — a run cancelled between tool iterations now reports `RunStatus: "cancelled"` instead of `"finished"`, so a caller can distinguish a cancellation from a clean completion. Previously the between-iteration abort break left the default `"finished"` status.
