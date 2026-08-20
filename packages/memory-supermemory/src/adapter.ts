/**
 * SupermemoryAdapter — `@theokit-memory-supermemory` core (T3.2, ADR D141).
 *
 * Wraps `supermemory` SDK v4. Implements `MemoryAdapter` so the SDK's
 * `pre_user_send` / `post_assistant_reply` hooks (D145) and
 * `agent.memory.*` direct API (D142) work end-to-end against Supermemory's
 * managed memory + RAG service.
 *
 * @public
 */

import {
  extractRawId,
  type MemoryAdapter,
  type MemoryAdapterCapabilities,
  MemoryAdapterError,
  type MemoryContext,
  type MemoryFact,
  type MemoryId,
  type MemoryToolSchema,
  type MemoryTurnMessage,
  mkMemoryId,
} from "@theokit/sdk";
import type Supermemory from "supermemory";
import SupermemoryClient from "supermemory";

import { buildContainerTags, primaryContainerTag } from "./translate.js";

/**
 * Configuration accepted by the `supermemoryMemory(...)` factory.
 *
 * @public
 */
export interface SupermemoryAdapterOptions {
  /**
   * Supermemory API key, forwarded verbatim to `new Supermemory({ apiKey })`.
   *
   * REQUIRED by this type. The `supermemory` client does default to `SUPERMEMORY_API_KEY` when it
   * receives `undefined`, but this adapter's `isAvailable()` reports `false` for an empty or
   * missing key, and the client is only built on the first `write` / `recall` — so an absent key
   * surfaces as `MemoryAdapterError(code: "auth_failed")` at the first call rather than at
   * `Agent.create`.
   */
  apiKey: string;
  /**
   * Base URL for a self-hosted Supermemory, forwarded as the vendor's `baseURL`.
   *
   * Omit it for Supermemory cloud; the vendor then reads `SUPERMEMORY_BASE_URL` and falls back to
   * its own production URL.
   */
  baseUrl?: string;
  /**
   * First segment of every containerTag this adapter writes and searches. Default `"theokit"`.
   *
   * Changing it PARTITIONS the memory: entries written under one prefix are invisible to an
   * adapter configured with another, which is what makes it useful for test isolation and
   * dangerous as a casual rename. Must match `/^[a-zA-Z0-9_-]+$/` — a bad value is rejected on the
   * first `write` / `recall`, not at construction.
   */
  containerTagPrefix?: string;
}

const ADAPTER_ID = "supermemory";

const CAPS: MemoryAdapterCapabilities = {
  history: false,
  sessions: false,
  tenancy: true,
  reasoning: false,
  toolSchemas: true,
  prefetch: false,
};

/**
 * SDK-internal adapter class. Construct via `supermemoryMemory(...)`
 * factory from `./index.ts`, not directly.
 *
 * @internal
 */
export class SupermemoryAdapter implements MemoryAdapter {
  readonly id = ADAPTER_ID;
  readonly capabilities = CAPS;
  readonly #opts: SupermemoryAdapterOptions;
  #client?: Supermemory;

  constructor(opts: SupermemoryAdapterOptions) {
    this.#opts = opts;
  }

  isAvailable(): boolean {
    return typeof this.#opts.apiKey === "string" && this.#opts.apiKey.length > 0;
  }

  async initialize(): Promise<void> {
    // Lazy: defer the actual client construction until first call.
    // initialize() is idempotent — see EC-3 / EC-I.
  }

  async write(content: string | MemoryTurnMessage[], ctx: MemoryContext): Promise<MemoryId> {
    const text = this.#renderContent(content);
    if (text.length === 0) {
      throw new MemoryAdapterError("write: empty content", {
        adapterId: ADAPTER_ID,
        code: "invalid_input",
      });
    }
    const containerTags = buildContainerTags(ctx, this.#prefix());
    try {
      const resp = await this.#sdk().documents.add({
        content: text,
        containerTags,
        ...(ctx.metadata !== undefined ? { metadata: ctx.metadata as Record<string, string> } : {}),
      });
      return mkMemoryId(ADAPTER_ID, resp.id);
    } catch (err) {
      throw this.#translateError(err, "write");
    }
  }

  async recall(query: string, ctx: MemoryContext, k = 10): Promise<MemoryFact[]> {
    if (k <= 0) return [];
    const containerTag = primaryContainerTag(ctx, this.#prefix());
    try {
      const resp = await this.#sdk().search.memories({
        q: query,
        containerTag,
        limit: k,
        rerank: true,
      });
      const results = resp.results ?? [];
      return results.map(this.#mapResult);
    } catch (err) {
      throw this.#translateError(err, "recall");
    }
  }

  async delete(id: MemoryId): Promise<void> {
    const rawId = extractRawId(id, ADAPTER_ID);
    try {
      await this.#sdk().documents.delete(rawId);
    } catch (err) {
      throw this.#translateError(err, "delete");
    }
  }

  getToolSchemas(): MemoryToolSchema[] {
    return [
      {
        name: "memory_write",
        description:
          "Persist a fact about the user or context to Supermemory long-term memory. " +
          "Returns the stored memory ID.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "Fact text to persist verbatim." },
          },
          required: ["content"],
        },
      },
      {
        name: "memory_recall",
        description:
          "Retrieve up to k semantically relevant facts from Supermemory long-term memory. " +
          "Returns an array of {id, content, score, createdAt} objects.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Free-text query to search memory." },
            k: {
              type: "integer",
              minimum: 1,
              maximum: 50,
              description: "Max results (default 10).",
            },
          },
          required: ["query"],
        },
      },
    ];
  }

  async handleToolCall(
    name: string,
    args: Record<string, unknown>,
    ctx: MemoryContext,
  ): Promise<string> {
    if (name === "memory_write") {
      const content = String(args.content ?? "");
      const id = await this.write(content, ctx);
      return JSON.stringify({ ok: true, id });
    }
    if (name === "memory_recall") {
      const query = String(args.query ?? "");
      const k = typeof args.k === "number" ? args.k : 10;
      const facts = await this.recall(query, ctx, k);
      return JSON.stringify({ ok: true, facts });
    }
    throw new MemoryAdapterError(`Unknown tool name: ${name}`, {
      adapterId: ADAPTER_ID,
      code: "invalid_input",
    });
  }

  async shutdown(): Promise<void> {
    this.#client = undefined;
  }

  // ── helpers ────────────────────────────────────────────────────────

  #prefix(): string {
    return this.#opts.containerTagPrefix ?? "theokit";
  }

  #renderContent(content: string | MemoryTurnMessage[]): string {
    if (typeof content === "string") return content.trim();
    return content
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n")
      .trim();
  }

  #mapResult = (r: unknown): MemoryFact => {
    const obj = (r as Record<string, unknown>) ?? {};
    // SDK shape: { memory?: { id, content, ... }, score, ... } or chunk shape.
    const memory = (obj.memory as Record<string, unknown> | undefined) ?? obj;
    const rawId = String(memory.id ?? obj.id ?? "");
    const content = String(memory.content ?? memory.text ?? obj.content ?? "");
    const score = typeof obj.score === "number" ? obj.score : undefined;
    const createdAt = typeof memory.createdAt === "string" ? memory.createdAt : undefined;
    return {
      id: mkMemoryId(ADAPTER_ID, rawId),
      content,
      ...(score !== undefined ? { score } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
    };
  };

  #sdk(): Supermemory {
    if (this.#client === undefined) {
      this.#client = new SupermemoryClient({
        apiKey: this.#opts.apiKey,
        ...(this.#opts.baseUrl !== undefined ? { baseURL: this.#opts.baseUrl } : {}),
      });
    }
    return this.#client;
  }

  #translateError(err: unknown, op: string): MemoryAdapterError {
    if (err instanceof MemoryAdapterError) return err;
    const status =
      (err as { status?: number; statusCode?: number })?.status ??
      (err as { statusCode?: number })?.statusCode;
    const message = (err as Error)?.message ?? String(err);
    if (status === 401 || status === 403) {
      return new MemoryAdapterError(`Supermemory auth failed (${op}): ${message}`, {
        adapterId: ADAPTER_ID,
        code: "auth_failed",
        cause: err,
      });
    }
    if (status === 429) {
      return new MemoryAdapterError(`Supermemory rate limited (${op}): ${message}`, {
        adapterId: ADAPTER_ID,
        code: "rate_limited",
        cause: err,
      });
    }
    if (status === 404) {
      return new MemoryAdapterError(`Supermemory not found (${op}): ${message}`, {
        adapterId: ADAPTER_ID,
        code: "not_found",
        cause: err,
      });
    }
    if (status === undefined && message.toLowerCase().includes("network")) {
      return new MemoryAdapterError(`Supermemory network error (${op}): ${message}`, {
        adapterId: ADAPTER_ID,
        code: "network",
        cause: err,
      });
    }
    return new MemoryAdapterError(`Supermemory error (${op}): ${message}`, {
      adapterId: ADAPTER_ID,
      code: "unknown",
      cause: err,
    });
  }
}
