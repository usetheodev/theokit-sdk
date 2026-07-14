---
"@theokit/sdk": patch
---

Fix (#65) — the `transform_llm_output` plugin hook now rewrites the FINAL user-visible / streamed assistant text, and fires on text-only terminal turns. Previously it ran only in the tool-call branch and folded only into internal message history, so a plugin could not scrub what the caller actually received. The transform is now applied once, up front, and flows into the emitted step, `finalText`/`result`, and message history alike.
