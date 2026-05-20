# Memory write + recall

Persistent durable facts via `AgentOptions.memory`. When the user message
starts with `Remember: <fact>` (`memory.enabled === true`), the SDK
persists the fact under
`.theokit/memory/<namespace>/<scope>-<userId>.json` **before** the LLM
call — durability is guaranteed even if the LLM call fails. Every
subsequent send auto-injects the persisted facts as a `<memory>` block
in the system prompt.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it does

1. Spawns Agent #1 → tells it `Remember: the magic-number for this workspace is 8675309.`
2. The SDK persists the fact (auto-write-on-send). The LLM acknowledges.
3. Disposes Agent #1.
4. Spawns Agent #2 against the same workspace.
5. Asks Agent #2 the magic-number → it recalls 8675309 via the
   auto-injected `<memory>` block.

## v1 limitations

- **Concurrency** — memory writes are read-modify-write at v1; concurrent
  `send()` calls that both persist facts on the same workspace can race
  (the second write overwrites the first). Isolate via distinct `userId`
  / `namespace` or serialize the sends.
- **Cross-provider token budget** — the SDK does not impose a global
  system-prompt budget. Keep memory size modest.

To opt out of auto-injection (keep persistence but format facts via your
own resolver): `memory: { enabled: true, autoInject: false }`. The
`systemPrompt` resolver still receives `ctx.memory`.
