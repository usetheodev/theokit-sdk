# Edge Case Review — theocode-phase1-tools

Date: 2026-06-11
Tasks analyzed: 7 (T1.1-T1.7)
Edge cases found: 6 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 1)

## MUST FIX

### EC-1: Write tool can overwrite binary files (images, compiled assets) without warning
- **Affected task:** T1.1
- **Family:** Input / State
- **Scenario:** LLM calls `createWriteFileTool` with a path pointing to a binary file (e.g., `dist/bundle.js.map`, `assets/logo.png`). The tool overwrites it with text content, corrupting the binary.
- **Impact:** Silent data corruption of non-text files.
- **Suggested fix:** Add binary file detection (probe first 8KB for null bytes, same as `read-file.ts`). If binary detected AND content is text, return `{ ok: false, error: "binary_file" }`.

### EC-2: Edit tool backup (.bak) accumulates forever — no cleanup
- **Affected task:** T1.2
- **Family:** State / Resource
- **Scenario:** Every edit creates a `.bak` file. After 100 edits on the same file, there are 100 `.bak` files (or the same `.bak` is overwritten each time). If overwritten, the backup is only the last version — not useful for multi-step undo. If accumulated, disk fills.
- **Impact:** Either disk waste or false sense of backup safety.
- **Suggested fix:** Single `.bak` per file (overwrite each time). Document that `.bak` is a last-resort safety net, not a version history. One line: `await writeFile(path + ".bak", originalContent)` (overwrite mode).

## SHOULD TEST

### EC-3: WebFetch tool with redirect chains
- **Affected task:** T1.6
- **Suggested test:** `test_fetch_follows_redirects()` — verify native `fetch` follows 301/302 redirects (default behavior). Also `test_fetch_max_redirects()` — verify redirect loop (A→B→A) doesn't hang (native fetch has default limit of 20).

### EC-4: ApplyPatch with CRLF line endings
- **Affected task:** T1.5
- **Suggested test:** `test_patch_handles_crlf()` — verify patch application works when the target file has `\r\n` line endings but the diff has `\n` only. This is common on Windows repos.

### EC-5: Glob tool with symlink loops
- **Affected task:** T1.3
- **Suggested test:** `test_glob_ignores_symlink_loops()` — create a symlink loop in temp dir, verify glob doesn't hang. Node's `glob` package handles this by default, but test it explicitly.

## DOCUMENT

### EC-6: Shell tool output encoding — non-UTF-8 output silently garbled
- **Accepted risk:** `LocalSandbox.execute()` uses `encoding: "utf-8"` for stdout/stderr. Commands producing non-UTF-8 output (e.g., binary data, Latin-1 logs) will have garbled characters. Acceptable because: (a) 99% of CLI tools output UTF-8, (b) binary output should use file redirection not stdout capture, (c) fixing requires Buffer handling + encoding detection which is out of scope for v1.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 1 (EC-1) | 0 | 0 |
| T1.2 | 1 | 1 (EC-2) | 0 | 0 |
| T1.3 | 1 | 0 | 1 (EC-5) | 0 |
| T1.4 | 1 | 0 | 0 | 1 (EC-6) |
| T1.5 | 1 | 0 | 1 (EC-4) | 0 |
| T1.6 | 1 | 0 | 1 (EC-3) | 0 |
| T1.7 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 2 MUST FIX:
1. EC-1: Binary file guard on write tool
2. EC-2: Define backup strategy (single .bak overwrite)
