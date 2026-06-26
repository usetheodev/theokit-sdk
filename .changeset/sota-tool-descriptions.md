---
"@theokit/sdk-tools": minor
---

SOTA default descriptions for the 9 built-in tools (`read_file`/`write_file`/`edit_file`/`glob_files`/`search_text`/`shell_exec`/`todolist`/`web_fetch`/`web_search`).

Each tool's default `description` is upgraded from terse mechanics-only copy to rich, behavior-accurate ACI copy (preconditions, when-to-prefer-which-tool, return shape) — the Agent-Computer Interface the model reads to choose tools, which measurably improves tool-selection. Every claim is verified against the tool's own handler (e.g. `search_text` is described as LITERAL + CASE-SENSITIVE because it matches via `line.includes`; `web_fetch` is described as SSRF-guarded because `screenedFetch` defaults `allowPrivateHosts: false`), so the description lives next to the implementation it describes and cannot drift. Descriptions are generalized (no app-specific cross-tool references). No API change: same factory signatures, same return shapes; only the default description string changed. Consumers no longer need to override these descriptions app-side — `withDescription` remains for genuine per-consumer customization. Added `tests/sota-descriptions.test.ts` asserting each description's load-bearing behavioral phrases.
