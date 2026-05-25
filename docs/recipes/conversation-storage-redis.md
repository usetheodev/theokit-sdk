# Recipe: Redis-backed `ConversationStorageAdapter`

Persists conversation history as a per-conversation Redis list. Best for hot read paths + cross-region replicas.

## When to use

- Latency-sensitive chat (read sub-ms)
- Read replicas in multiple regions (Redis Cluster, Upstash global)
- Conversations have a natural TTL (auto-expire after 30 days)

## Install (Node — connection-based)

```bash
npm install ioredis
```

## Install (Cloudflare Workers / a peer vendor Edge — HTTP-based)

```bash
npm install @upstash/redis
```

## Adapter (Node / ioredis)

```ts
import Redis from "ioredis";
import type {
  ConversationStorageAdapter,
  StoredMessage,
} from "@usetheo/sdk";

export class RedisConversationStorage implements ConversationStorageAdapter {
  constructor(
    private readonly redis: Redis,
    private readonly opts: { keyPrefix?: string; ttlSeconds?: number } = {},
  ) {}

  private key(conversationId: string): string {
    return `${this.opts.keyPrefix ?? "agent:conversation"}:${conversationId}`;
  }

  async getMessages(conversationId: string): Promise<readonly StoredMessage[]> {
    const raw = await this.redis.lrange(this.key(conversationId), 0, -1);
    return raw.map((s) => JSON.parse(s) as StoredMessage);
  }

  async appendMessage(conversationId: string, message: StoredMessage): Promise<void> {
    const stamped: StoredMessage = { ...message, at: message.at ?? Date.now() };
    const k = this.key(conversationId);
    // Atomic via Redis single-threaded model. TTL refreshed on every append.
    const pipeline = this.redis.multi().rpush(k, JSON.stringify(stamped));
    if (this.opts.ttlSeconds !== undefined) {
      pipeline.expire(k, this.opts.ttlSeconds);
    }
    await pipeline.exec();
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.redis.del(this.key(conversationId));
  }

  async listConversationIds(opts: { limit?: number } = {}): Promise<readonly string[]> {
    // SCAN is preferred over KEYS in production (non-blocking).
    const prefix = `${this.opts.keyPrefix ?? "agent:conversation"}:`;
    const ids: string[] = [];
    let cursor = "0";
    const limit = opts.limit ?? 1000;
    do {
      const [next, batch] = await this.redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
      for (const k of batch) ids.push(k.slice(prefix.length));
      cursor = next;
      if (ids.length >= limit) break;
    } while (cursor !== "0");
    return ids.slice(0, limit);
  }

  async dispose(): Promise<void> {
    await this.redis.quit();
  }
}
```

## Adapter (Cloudflare Workers / a peer vendor Edge — Upstash HTTP)

```ts
import { Redis } from "@upstash/redis";
import type {
  ConversationStorageAdapter,
  StoredMessage,
} from "@usetheo/sdk";

export class UpstashConversationStorage implements ConversationStorageAdapter {
  constructor(
    private readonly redis: Redis,
    private readonly opts: { keyPrefix?: string; ttlSeconds?: number } = {},
  ) {}

  private key(conversationId: string): string {
    return `${this.opts.keyPrefix ?? "agent:conversation"}:${conversationId}`;
  }

  async getMessages(conversationId: string): Promise<readonly StoredMessage[]> {
    const raw = await this.redis.lrange(this.key(conversationId), 0, -1);
    return raw.map((s) => (typeof s === "string" ? (JSON.parse(s) as StoredMessage) : (s as StoredMessage)));
  }

  async appendMessage(conversationId: string, message: StoredMessage): Promise<void> {
    const stamped: StoredMessage = { ...message, at: message.at ?? Date.now() };
    const k = this.key(conversationId);
    await this.redis.rpush(k, JSON.stringify(stamped));
    if (this.opts.ttlSeconds !== undefined) {
      await this.redis.expire(k, this.opts.ttlSeconds);
    }
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.redis.del(this.key(conversationId));
  }
}
```

## Usage with `Agent.create`

```ts
import { Agent } from "@usetheo/sdk";
import Redis from "ioredis";
import { RedisConversationStorage } from "./redis-conversation-storage.js";

const redis = new Redis(process.env.REDIS_URL!);
const conversationStorage = new RedisConversationStorage(redis, {
  keyPrefix: "myapp:agent",
  ttlSeconds: 60 * 60 * 24 * 30, // 30 days
});

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

Always wire your storage at the route-handler level:

```ts
// In your Express/Hono/Worker route:
const agent = await Agent.getOrCreate(conversationId, {
  apiKey,
  model,
  conversationStorage, // ← every request
});
```

## TTL behavior

The recipe sets `EXPIRE` on every append, which **resets** the TTL — conversations that get a new message every day never expire. To use absolute TTL (expire 30 days after creation regardless of activity), use `EXPIREAT` with the `at` timestamp.
