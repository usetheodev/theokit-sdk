---
"@theokit/sdk-tools": minor
---

`createApplyPatchTool` now parses Codex's **V4A patch grammar** (`*** Begin Patch` … `*** End Patch`;
`*** Add/Update/Delete File:`, optional `*** Move to:`, `@@`-anchored `+`/`-`/context hunks) instead of a
unified diff — the format the model actually emits in a Codex-style agent. **BREAKING:** the `{ patch }`
input is now a V4A patch, not a unified diff. Matching uses a context-tolerant ladder (exact → rstrip →
trim → unicode) mirroring Codex `seek_sequence`; `@@ <ctx>` anchors the search; `*** End of File` anchors
to the tail. Applied **strictly atomically** — the whole patch is planned (every file read + new content
computed + path security-checked) before any write, so a parse error / context mismatch / path violation
anywhere yields a typed error and ZERO writes (stronger than Codex, which can leave partial writes).
Add File strips one `+` and always ends with a trailing newline; Update+Move transforms the old content
and renames. New `internal/v4a-patch.ts` parser/matcher.
