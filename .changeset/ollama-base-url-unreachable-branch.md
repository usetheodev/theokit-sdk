---
"@theokit/sdk": patch
---

Removes an unreachable `ollama` arm from the provider base-URL resolver. `OLLAMA_HOST` is unaffected
and keeps working exactly as before.

The router's base-URL env switch carried a `case "ollama"` returning `process.env.OLLAMA_HOST`. It
never ran. Ollama is served by its own native client, which the transport selector returns before the
OpenAI-compatible branch — the only place that switch is consulted — so the arm was unreachable from
the first line of the function containing it. Measured two ways: line coverage over the router and
provider suites puts the arm at 0 entries while all four siblings are entered, and a probe that
replaced its body with a throw was never triggered by any test, plugin profile or alias.

The one construction that could reach it is a provider profile whose `name` getter returns a
different value on successive reads — a profile contradicting itself. Run against the old code, that
path shows what the line actually did: it pointed the **OpenAI-compatible** transport at the Ollama
host, producing `…/v1/chat/completions` against an Ollama daemon. That is the failure mode ADR D191
exists to prevent — models emitting raw tool JSON as plain text. So this is not merely an inert line
being tidied away; it is a latent bug being removed on the only path that reached it.

The line also cost real time as a decoy: it reads exactly like the mechanism implementing
`OLLAMA_HOST` and is not. A repair pass mutated it, measured a green suite, and concluded the real
override was untested. The real one lives on the native branch and is now pinned by a test asserting
that an ollama request reaches `/api/chat` at the configured host, so the routing this removal
depends on cannot change unnoticed.
