---
"@theokit/sdk-tools": patch
---

M15 review fixes (injected fs path only; local path unaffected): (1) the backend directory walk in
`glob_files`/`search_text` decides entry type via `stat` (which follows symlinks), so an in-boundary
symlink cycle could recurse until PATH_MAX — now depth-capped so it terminates; (2) `edit_file`'s
backend read mapped every failure to `not_found` — now only a genuinely missing file (`FileNotFoundError`)
maps to `not_found`; any other read error (e.g. a directory, a permission error) propagates (fail-loud),
matching the local path's ENOENT-only classification.
