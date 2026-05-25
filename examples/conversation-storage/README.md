# `examples/conversation-storage` — Production-Readiness #1

Demonstrates the `ConversationStorageAdapter` plug-in pattern.

## Run

```bash
# Fixture mode (no LLM call, validates wiring only):
pnpm run

# Real LLM (OpenRouter via OPENROUTER_API_KEY):
OPENROUTER_API_KEY=sk-or-... pnpm run
```

## What it shows

1. Create an agent with `InMemoryConversationStorage` (zero infra needed)
2. Send a message; storage state observable
3. **Strict resume (D325):** `Agent.resume` without `conversationStorage` throws `ConfigurationError(code: "conversation_storage_required")` — prevents silent FS fallback that would lose Postgres history
4. Resume passing storage again → success
5. Lists `AgentRunError` discriminated codes for consumer branching

## For Postgres / Redis

See `docs/recipes/conversation-storage-postgres.md` and `docs/recipes/conversation-storage-redis.md`.
