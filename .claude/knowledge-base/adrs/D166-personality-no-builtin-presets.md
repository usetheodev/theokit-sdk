# D166 — The SDK ships zero built-in personality presets

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`@usetheo/sdk` does not ship any default personality presets. The
registry starts empty unless the user populates
`.theokit/personalities/*.md` (project) or
`~/.theokit/personalities/*.md` (user). Examples ship a sample preset
or two (e.g., `coder.md`, `poet.md` in telegram-pro) but those live in
each example's directory, not in the SDK package.

## Rationale

Built-in presets create a tax on every consumer: people who don't want
"coder" or "poet" see them in `/personality` listings; people who do
want them inherit whatever wording the SDK chose, which goes stale.
Voice is the most personal part of an agent — the SDK should not
prescribe.

## Consequences

- **Enables:** no SDK opinion on tone; users own their presets.
- **Constrains:** the docs must explain how to write a preset (sample
  files in `examples/telegram-pro/.theokit/personalities/` are the
  canonical reference).
