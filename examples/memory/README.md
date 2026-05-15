# Memory persistence

Persistent durable facts via `AgentOptions.memory`. Writes to
`.theokit/memory/<scope>.json` under the workspace. Two separate
agent handles share the same memory file — the second one recalls
what the first one was asked to remember.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it does

1. Spawns Agent #1 → tells it "Remember: the magic-number for this workspace is 8675309."
2. Disposes Agent #1 (it persists the fact to `.theokit/memory/global.json`).
3. Spawns Agent #2 against the same workspace.
4. Asks Agent #2 the magic-number — it recalls 8675309 from memory.

## ⚠️ Implementation status

Memory write + persistence to `.theokit/memory/<scope>.json` works in
**both** fixture and real runtime — fixture-mode contract tests prove
the round-trip. However, in the **real LLM runtime** the persisted
facts are NOT yet auto-injected into the second agent's LLM messages
on send, so Agent #2 answers "undefined" today. The fixture-mode
runtime does inject them via pattern matching, which is why contract
tests pass.

Tracking: extend `real-local-run.ts` `buildLoopInputs` to read
`memoryFacts` and prepend them as a system context block (similar to
the context-manager wiring).

Workaround today: pass memory facts manually via your own
`systemPrompt` resolver that reads from disk.
