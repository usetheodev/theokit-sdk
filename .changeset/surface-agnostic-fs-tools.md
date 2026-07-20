---
"@theokit/sdk-tools": minor
---

M15 — complete the surface-agnostic tool injection. `search_text`, `glob_files`, and `edit_file` now
accept an optional `filesystem` (`FilesystemProvider`), joining `shell_exec`/`git_diff` (`sandbox`) and
`interactive_shell`/`write_stdin` (`interactive`). When a backend is injected the recursive walk / read
/ backup / write go through it in project-relative path space (so the tool runs unchanged on a local
disk, a cluster container, or a Tauri desktop); when omitted the local `fs` path is byte-identical to
before. Backward compatibility is proven by conformance tests that run each tool through the real
`LocalFilesystem`/`LocalSandbox` backends and assert identical output to the local path. Additive — no
breaking change.
