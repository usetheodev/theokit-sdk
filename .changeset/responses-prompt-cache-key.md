---
'@theokit/sdk': minor
---

Responses-API requests now carry `prompt_cache_key`, so the provider can reuse the cached prompt
prefix between rounds instead of re-charging the whole system prompt and tool schema every time.

Measured on a consumer product against OpenAI Codex — same provider, same model, same reasoning
effort, same task — the SDK sent a THIRD of the bytes (24,691 c vs 76,331 c) and paid 2.8x the tokens
(24,914 vs 9,036). The difference was not what was sent; it was that theirs was cached and ours was
not, because no key told the provider which prefix to match.

The key is derived (SHA-256, truncated, prefixed) from the run's session identity — the id
`Agent.getOrCreate(sessionId)` keys on — so it is identical across every round of a turn and every
turn of a session, different for unrelated sessions, and stable across a process restart, while
disclosing nothing about a caller-chosen session name. Both halves matter: a key that changes per
round caches nothing, and a key shared between sessions asks the provider to match one conversation's
prefix against another's.

Alongside it, a provider profile may now declare `encryptedReasoning: true`. When it does, the
request adds `include: ["reasoning.encrypted_content"]` and `reasoning.context: "all_turns"`, and the
transport replays the ciphertext the provider returned immediately before the tool call it produced,
so the model does not re-derive its chain of thought on every round. It is off by default and on for
the builtin `openai-chatgpt` profile: `include` is a documented Responses-API field but
`reasoning.context` is not, and that endpoint is the one where acceptance was observed rather than
assumed. Every other provider's request body is unchanged.

`store` stays `false`, now as a recorded decision rather than an unexamined default. Codex sends
`true`; SDK requests routinely carry a consumer's source code and shell output from machines whose
operator never agreed to server-side retention, and nothing in the caching work needs it — the cache
key handles the prefix and the encrypted-reasoning carry is precisely the mechanism for keeping
reasoning without server-side state.

Fixes `usetheokit/theokit-sdk#383`.
