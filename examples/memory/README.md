# Memory recall

Durable facts persisted under `.theokit/memory/<namespace>/<scope>-<userId>.json`
are auto-injected into the LLM system prompt as a `<memory>` block on
every send.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it does

1. Writes a fact to `.theokit/memory/demo/agent-user-1.json` directly
   (simulates a prior session or external persistence).
2. Creates an agent with `memory: { enabled: true, ... }` against the
   same workspace.
3. Asks the LLM for the persisted value — the model recalls 8675309
   from the auto-injected `<memory>` block.

> v1 scope: auto-persistence-on-send ("user says 'remember', SDK
> writes the fact") is out of scope. Persist via your own code or
> via the fixture runtime. The **recall** side is wired end-to-end
> in the real LLM runtime.

## Behaviour

Recalled facts are auto-injected into the LLM system prompt as a
`<memory>` block on every send (ADR D5). Each fact's text is
XML-escaped before embedding (ADR D9). A corrupt memory file degrades
to "no facts loaded" with a stderr warning rather than crashing the
run (EC-4).

Opt out with `memory: { enabled: true, autoInject: false }` when you
want full control through a custom `systemPrompt` resolver. The
resolver still receives the recalled facts via `ctx.memory`.

> v1 limitation (EC-7): the SDK does not impose a cross-provider
> system-prompt token budget. Keep memory size modest. A future minor
> release may add a pipeline-level budget allocation.
