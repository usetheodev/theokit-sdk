# Recipe: Postgres-backed `ConversationStorageAdapter`

Persists conversation history in a single `agent_conversations` table. Survives a peer vendor cold starts, K8s rolling updates, and TheoCloud canary deploys.

## When to use

- Need consistency + transactional reads across multi-host deploys
- Already running Postgres for app data — reuse the same connection pool
- Want SQL-queryable history (compliance audits, billing reconciliation)

## Install (Node / Self-hosted)

```bash
npm install pg
npm install -D @types/pg
```

## Install (Cloudflare Workers / a peer vendor Edge)

```bash
npm install @neondatabase/serverless
```

## Schema

```sql
CREATE TABLE agent_conversations (
  id          TEXT PRIMARY KEY,
  messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX agent_conversations_updated_at_idx ON agent_conversations (updated_at DESC);
```

Optional: add a `user_id` column + index when you want per-user enumeration without scanning the whole table.

## Adapter (Node)

```ts
import { Pool } from "pg";
import type {
  ConversationStorageAdapter,
  StoredMessage,
} from "@theokit/sdk";

export class PostgresConversationStorage implements ConversationStorageAdapter {
  constructor(private readonly pool: Pool) {}

  async getMessages(conversationId: string): Promise<readonly StoredMessage[]> {
    const { rows } = await this.pool.query<{ messages: StoredMessage[] }>(
      "SELECT messages FROM agent_conversations WHERE id = $1",
      [conversationId],
    );
    return rows[0]?.messages ?? [];
  }

  async appendMessage(conversationId: string, message: StoredMessage): Promise<void> {
    const stamped: StoredMessage = { ...message, at: message.at ?? Date.now() };
    // Atomic upsert via jsonb concat. `||` appends; `coalesce` handles new rows.
    await this.pool.query(
      `INSERT INTO agent_conversations (id, messages, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET
         messages = agent_conversations.messages || $2::jsonb,
         updated_at = now()`,
      [conversationId, JSON.stringify([stamped])],
    );
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.pool.query("DELETE FROM agent_conversations WHERE id = $1", [conversationId]);
  }

  async listConversationIds(opts: { limit?: number } = {}): Promise<readonly string[]> {
    const limit = opts.limit ?? 1000;
    const { rows } = await this.pool.query<{ id: string }>(
      "SELECT id FROM agent_conversations ORDER BY updated_at DESC LIMIT $1",
      [limit],
    );
    return rows.map((r) => r.id);
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}
```

## Adapter (Cloudflare Workers / a peer vendor Edge — Neon HTTP)

```ts
import { neon } from "@neondatabase/serverless";
import type {
  ConversationStorageAdapter,
  StoredMessage,
} from "@theokit/sdk";

export class NeonConversationStorage implements ConversationStorageAdapter {
  private readonly sql: ReturnType<typeof neon>;

  constructor(connectionString: string) {
    this.sql = neon(connectionString);
  }

  async getMessages(conversationId: string): Promise<readonly StoredMessage[]> {
    const rows = (await this.sql`
      SELECT messages FROM agent_conversations WHERE id = ${conversationId}
    `) as Array<{ messages: StoredMessage[] }>;
    return rows[0]?.messages ?? [];
  }

  async appendMessage(conversationId: string, message: StoredMessage): Promise<void> {
    const stamped: StoredMessage = { ...message, at: message.at ?? Date.now() };
    await this.sql`
      INSERT INTO agent_conversations (id, messages, updated_at)
      VALUES (${conversationId}, ${JSON.stringify([stamped])}::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET
        messages = agent_conversations.messages || ${JSON.stringify([stamped])}::jsonb,
        updated_at = now()
    `;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.sql`DELETE FROM agent_conversations WHERE id = ${conversationId}`;
  }
}
```

## Usage with `Agent.create`

```ts
import { Agent } from "@theokit/sdk";
import { Pool } from "pg";
import { PostgresConversationStorage } from "./postgres-conversation-storage.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const conversationStorage = new PostgresConversationStorage(pool);

const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  agentId: `user-${userId}`,
  conversationStorage,
});
```

## Important — strict resume

When you pass a custom `conversationStorage`, the SDK marks the agent with `requiresCustomStorage: true` (D325). **You MUST pass `conversationStorage` again on `Agent.resume`** or you'll get:

```
ConfigurationError(code: "conversation_storage_required")
```

This is intentional — silent FS fallback would read an empty `.theokit/agents/<id>/messages.jsonl` and corrupt the conversation. Always wire your storage at the route-handler level:

```ts
// In your Express/Hono/Worker route:
const agent = await Agent.getOrCreate(conversationId, {
  apiKey,
  model,
  conversationStorage, // ← every request
});
```

## Cleanup

The adapter holds a `pg.Pool` reference. Call `conversationStorage.dispose()` on graceful shutdown:

```ts
process.on("SIGTERM", async () => {
  await conversationStorage.dispose();
  process.exit(0);
});
```
