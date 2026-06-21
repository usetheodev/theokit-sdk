---
"@theokit/sdk": minor
---

M4-2 — hierarchical project-instruction reader/writer (plan `m4-project-instructions`).

New `@theokit/sdk/project` subpath:

- `readProjectInstructions(cwd, options?)` — walk up from `cwd` collecting `<dir>/<filename>` (default `THEO.md`; configurable) up to the filesystem root (or `options.stopDir`). Returns `{ files, content }`: `files` are the found files nearest-first (`{ path, content }[]`, read in full), `content` is a reduction chosen by `options.scope` — `"nearest"` (innermost) or `"merged"` (all joined root-first, nearest text last). NEVER throws — missing/unreadable/non-file paths are skipped.
- `writeProjectInstructions(cwd, content, options?)` — write `<cwd>/<filename>` atomically (temp + fsync + rename). Fails loud on write errors (unlike the best-effort reader).

Composes the SDK's hardened `walkUpForFile` discovery + the atomic `replaceFileAtomic` writer (Rule 9). Zero new dependencies.
