---
"@theokit/sdk": minor
---

Hooks config reverts to JSON, in the exact Claude Code shape (ADR 0016, reverses D74/D77 for hooks). `.theokit/hooks.json` is canonical again and copy-paste compatible with a Claude Code `settings.json` hooks block: `{ "hooks": { "PreToolUse": [ { "matcher": "shell", "hooks": [ { "type": "command", "command": "…", "timeout": 30 } ] } ] } }`. Claude Code event names map to the SDK's five firing points (PreToolUse→preToolUse, PostToolUse→postToolUse, UserPromptSubmit→preRun, Stop→stop); unsupported events are skipped with a warning; `timeout` is in seconds. The legacy `.theokit/hooks/*.md` markdown form still loads but is deprecated. Rationale: a hook's markdown body is inert (unlike skills/context whose bodies are LLM-consumed), the file is machine-parsed (JSON is safer than YAML), and Claude Code — the reference implementation — configures hooks in JSON. Change is contained to the loader; executor + runtime firing unchanged.
