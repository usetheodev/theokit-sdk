# memory-supermemory-basic

End-to-end demo of [`@theokit-memory-supermemory`](../../packages/memory-supermemory).

Demonstrates:
- `agent.memory.write` / `recall` / `delete` direct API
- `pre_user_send` hook injecting Supermemory-recalled context into the LLM call
- Real-LLM validation per [`.claude/rules/real-llm-validation.md`](../../.claude/rules/real-llm-validation.md)

## Setup

```bash
cp .env.example .env
# Edit .env — set SUPERMEMORY_API_KEY and OPENROUTER_API_KEY
pnpm install
```

## Run

```bash
pnpm start
```

Expected output: 3 facts written, recall returns at least one match (rerank
true), LLM reply mentions "jazz" (or similar), 3 facts deleted.
