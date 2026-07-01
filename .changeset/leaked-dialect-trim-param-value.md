---
"@theokit/sdk": patch
---

Trim leaked-dialect tool-call parameter values during recovery. Models that leak the Hermes dialect as text (qwen3-coder) emit each parameter on its own line, so the recovered value carried the formatting newlines: `<parameter=path>\npackage.json\n</parameter>` produced `{ path: "\npackage.json\n" }`. Untrimmed, `read_file` / `glob_files` / `search_text` received a path/pattern wrapped in newlines and failed `not_found` (only `shell_exec` tolerated it, since bash ignores blank lines), so a multi-read investigation loop kept re-reading, never converged, and appeared to hang. The recovery extractor now trims each parameter value (leading/trailing whitespace only — internal newlines of a legitimate multi-line command survive), matching the native `tool_calls` path where such formatting noise never occurs. Values remain strings; downstream schema coercion is unchanged.
