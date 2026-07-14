# ADR 0016 — File-based hooks revert to JSON in the Claude Code shape (reverses D74/D77 for hooks)

- Status: Accepted
- Date: 2026-07-14
- Supersedes (for hooks only): ADR D74 (user-edited configs → markdown+frontmatter), ADR D77 (md-dir first, JSON fallback)
- Deciders: Paulo (owner)

## Context

D74 migrated the user-edited `.theokit/` configs (hooks, context, plugins) from JSON to markdown + YAML frontmatter, and D77 made the markdown directory canonical with a deprecated JSON fallback. The rationale was consistency with the skill pattern (`SKILL.md`) and JSON's weaknesses for hand-edited files (no comments, escaped multi-line strings, diff noise).

That reasoning holds for **context / personalities / skills**, where the markdown **body is load-bearing** — it is fed to the LLM as prompt content. It does **not** hold for **hooks**: a hook's markdown body is inert prose consumed by nothing (not the model, not the runtime). Only the frontmatter matters, and the file is **machine-parsed** by a deterministic loader — a consumer for which JSON is safer than YAML (which has real footguns: the Norway problem, implicit type coercion, indentation sensitivity).

Critically, **Claude Code — the reference implementation the SDK mirrors — configures hooks in `settings.json` (JSON)**, not markdown; it reserves markdown for skills/commands/subagents. The SDK diverged by sweeping hooks into the D74 markdown migration via pattern-matching ("all human-edited config → markdown"), when hooks are structurally the odd one out.

## Decision

File-based hooks revert to **JSON, in the exact Claude Code shape**. `.theokit/hooks.json` becomes canonical again:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "shell",
        "hooks": [ { "type": "command", "command": "node .theokit/policy.js", "timeout": 30 } ] } ]
  }
}
```

- **Structure** — identical to Claude Code's `settings.json` hooks: `hooks.<Event>[]` of `{ matcher?, hooks: [{ type: "command", command, timeout? }] }`.
- **Event names** — Claude Code's PascalCase names, mapped to the five events the SDK runtime actually fires: `PreToolUse`→`preToolUse`, `PostToolUse`→`postToolUse`, `UserPromptSubmit`→`preRun`, `Stop`→`stop`. A Claude Code event with no SDK firing point (`SessionStart`, `SubagentStop`, `PreCompact`, `Notification`, `SessionEnd`) is **skipped with a warning** — never silently accepted (it would never run).
- **`timeout`** is in **seconds** (Claude Code convention), converted to the internal `timeoutMs`.
- The change is **contained to the loader** (`hooks-source.ts`): the executor, the runtime firing sites, and the internal `HookConfig`/`HookEvent` vocabulary are unchanged.
- The legacy `.theokit/hooks/*.md` markdown form is **not supported** — a stray markdown dir (no `hooks.json`) is not loaded and emits a one-time migration warn. (Keeping it as a live fallback pulled the markdown-frontmatter Zod schema into the main bundle for a path Claude Code never had; JSON-only is both leaner and truer to "exactly Claude Code".)

D74 is **not** reversed for context / personalities / skills — their markdown bodies are LLM-consumed and the rationale still applies. This ADR narrows D74/D77 to exclude hooks.

## Consequences

- **Parity with Claude Code** — a `.theokit/hooks.json` is copy-paste compatible with a Claude Code `settings.json` hooks block.
- **Safer machine parsing** — canonical path is manual JSON validation (no YAML, no zod coupling); typed `ConfigurationError` on a bad shape or a non-`command` type.
- **Back-compat** — existing `.theokit/hooks/*.md` users keep working (deprecated warn); the `telegram-pro` example + all docs migrated to `hooks.json`.
- **`theokit-migrate-config`** — the migration direction reverses (md → json); CLI update tracked as a follow-up (the loader accepts both meanwhile).

## Alternatives rejected

- **Keep markdown for hooks** — the elk of the D74 migration; the body carries no payload, and it diverges from Claude Code. Rejected (this ADR).
- **Revert to the SDK's old *flat* JSON** (`{ hooks: { preToolUse: [{ command, matcher }] } }`) — simpler, but NOT "the Claude Code shape"; owner explicitly wanted exact Claude Code parity. Rejected.
- **One JSON file per hook** (`.theokit/hooks/<name>.json`) — keeps D75's per-file review/blame with JSON safety, but diverges from Claude Code's single-file `settings.json` model. A reasonable future option; rejected now for exact parity.
