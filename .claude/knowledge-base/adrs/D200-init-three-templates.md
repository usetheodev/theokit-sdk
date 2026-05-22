# D200 — Three initial `theokit init` templates: `minimal`, `ollama-local`, `telegram-bot`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

CLI v0.1 ships exactly three bundled templates:

1. **`minimal`** — canonical SDK entry: `Agent.create + send + stream`.
   No provider lock-in (.env.example lists all three cloud keys).
2. **`ollama-local`** — leverages D182 (Ollama integration). Zero
   remote API key path; runs against `ollama serve`.
3. **`telegram-bot`** — leverages `@usetheo/gateway` + grammy. Most
   common chat-platform onboarding vertical.

Excluded from v1:
- Discord (similar to Telegram; defer to v1.1).
- React app (covered by Docs site #3).
- RAG (Ollama-local already demos embedding path indirectly).

## Rationale

- **Coverage**: minimal = "any provider", ollama-local = "no API key",
  telegram-bot = "platform demo". Three distinct use cases.
- **Existing assets**: SDK already ships full `examples/telegram-pro`
  + `examples/ollama-hello`; the templates are stripped-down versions
  optimized for first-time UX.
- **Scope discipline**: three templates ≈ 60KB of tarball overhead.
  Capping at 3-5 templates prevents the package from becoming a
  template-zoo.

Alternatives rejected:

- **One template only (`minimal`)** — misses the Ollama-local value
  prop entirely.
- **Five+ templates** — every template is maintained code; risk of
  breakage compounds.

## Consequences

- Enables: 3 distinct onboarding paths out of the gate.
- Constrains: adding a 4th template requires CLI minor bump (semver
  contract for templates). Removing a template = major bump.
