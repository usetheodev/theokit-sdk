# `@theokit/sdk` Recipes

Drop-in templates for production scenarios. Each recipe is **copy-paste ready** — install the listed peer deps and paste the file into your project. SDK keeps these out of core deps to stay light (~50KB bundle); the templates are the canonical way to extend the SDK against your infra.

## Conversation storage adapters

The SDK ships `FileSystemConversationStorage` (default, `.theokit/agents/<id>/messages.jsonl`) and `InMemoryConversationStorage` (tests + ephemeral). Serverless and multi-host deploys need a shared backend:

- **[conversation-storage-postgres.md](./conversation-storage-postgres.md)** — `pg` (Node) or `@neondatabase/serverless` (CF Workers / Vercel Edge). Best for relational consistency + structured queries on history.
- **[conversation-storage-redis.md](./conversation-storage-redis.md)** — `ioredis` (Node) or `@upstash/redis` (HTTP). Best for hot conversation read paths + cross-region replicas.

## When to use which

| Scenario | Adapter | Why |
|---|---|---|
| Self-hosted Node single VPS / Docker volume | `FileSystemConversationStorage` (default) | Zero infra. JSONL is crash-safe at line granularity. |
| Vitest / dev CLI | `InMemoryConversationStorage` | No FS noise. Cleared between tests. |
| Vercel Functions / Cloudflare Workers / AWS Lambda | Postgres OR Redis recipe | Filesystem ephemeral. Must use shared backend. |
| K8s multi-pod / TheoCloud canary | Postgres OR Redis recipe | Same user lands on different pods across requests. |
| Read-heavy chat with low write rate | Postgres recipe | jsonb consistency + indexable queries. |
| Burst write loads + ephemeral history | Redis recipe | Fast RPUSH/LRANGE; TTL eviction native. |
