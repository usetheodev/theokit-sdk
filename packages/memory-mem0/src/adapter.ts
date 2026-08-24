/**
 * Mem0Adapter — `@theokit/memory-mem0` core (T5.1, ADR D141 / D148).
 *
 * Wraps `mem0ai` `MemoryClient` (cloud-only per D148). Implements
 * `MemoryAdapter` with the unique `history(id)` capability — the only
 * adapter today that exposes per-memory versioning.
 *
 * Includes a circuit breaker (EC-K: 5xx counts; 429 does NOT trip).
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
  type MemoryRevision,
  type MemoryToolSchema,
  type MemoryTurnMessage,
  mkMemoryId,
} from "@theokit/sdk";
import MemoryClient from "mem0ai";

import { CircuitBreaker, type CircuitBreakerOptions } from "./circuit-breaker.js";
import { toMem0Options } from "./translate.js";

/**
 * Configuration accepted by the `mem0Memory(...)` factory.
 *
 * @public
 */
export interface Mem0AdapterOptions {
  /**
   * Mem0 API key. Genuinely required — `mem0ai` reads no `MEM0_API_KEY` environment variable, so
   * there is no fallback anywhere in the chain.
   *
   * The client is built lazily on the first `write` / `recall`, so a wrong key does not fail
   * `Agent.create`; it surfaces as `MemoryAdapterError(code: "auth_failed")` on the first call.
   */
  apiKey: string;
  /** Alternate Mem0 API host. Omit for Mem0 cloud, which is the vendor default. */
  host?: string;
  /** Mem0 organization to scope writes to. Forwarded only when set. */
  organizationId?: string;
  /** Mem0 project to scope writes to. Forwarded only when set. */
  projectId?: string;
  /**
   * Circuit-breaker tuning. Defaults: trip after 5 failures, 2-minute cooldown.
   *
   * The breaker is PER ADAPTER INSTANCE — one `mem0Memory(...)` call, one breaker. Two agents
   * built from two separate factory calls do not share it, so one agent tripping does not
   * protect the other.
   */
  breaker?: CircuitBreakerOptions;
}

const ADAPTER_ID = "mem0";

const CAPS: MemoryAdapterCapabilities = {
  history: true, // ← unique to Mem0
  sessions: true,
  tenancy: true,
  reasoning: false,
  toolSchemas: true,
  prefetch: false,
};

/** @internal */
export class Mem0Adapter implements MemoryAdapter {
  readonly id = ADAPTER_ID;
  readonly capabilities = CAPS;
  readonly #opts: Mem0AdapterOptions;
  readonly #breaker: CircuitBreaker;
  #client?: MemoryClient;

  constructor(opts: Mem0AdapterOptions) {
    this.#opts = opts;
    this.#breaker = new CircuitBreaker(opts.breaker);
  }

  isAvailable(): boolean {
    return typeof this.#opts.apiKey === "string" && this.#opts.apiKey.length > 0;
  }

  async initialize(): Promise<void> {
    // Lazy: client constructed on first call.
  }

  async write(content: string | MemoryTurnMessage[], ctx: MemoryContext): Promise<MemoryId> {
    this.#breaker.ensureClosed("write");
    const messages = this.#toMessages(content);
    if (messages.length === 0) {
      throw new MemoryAdapterError("write: empty messages", {
        adapterId: ADAPTER_ID,
        code: "invalid_input",
      });
    }
    try {
      const opts = toMem0Options(ctx);
      const resp = await this.#sdk().add(messages, opts);
      this.#breaker.recordSuccess();
      const first = resp[0];
      const rawId = first?.id ?? `mem0-${Date.now()}`;
      return mkMemoryId(ADAPTER_ID, rawId);
    } catch (err) {
      throw this.#translateError(err, "write");
    }
  }

  async recall(query: string, ctx: MemoryContext, k = 10): Promise<MemoryFact[]> {
    if (k <= 0) return [];
    this.#breaker.ensureClosed("recall");
    try {
      const opts = toMem0Options(ctx);
      const resp = await this.#sdk().search(query, {
        // Read filter: cross-session recall keyed by user_id (Hermes pattern).
        ...(opts.user_id !== undefined ? { filters: { user_id: opts.user_id } } : {}),
        topK: k,
        rerank: true,
      });
      this.#breaker.recordSuccess();
      const list = Array.isArray(resp) ? resp : ((resp as { results?: unknown[] }).results ?? []);
      return (list as Array<Record<string, unknown>>).map((r) => ({
        id: mkMemoryId(ADAPTER_ID, String(r.id ?? "")),
        content: String(r.memory ?? r.content ?? ""),
        ...(typeof r.score === "number" ? { score: r.score as number } : {}),
        ...(r.createdAt !== undefined ? { createdAt: String(r.createdAt) } : {}),
        ...(r.metadata !== undefined ? { metadata: r.metadata as Record<string, unknown> } : {}),
      }));
    } catch (err) {
      throw this.#translateError(err, "recall");
    }
  }

  async delete(id: MemoryId): Promise<void> {
    this.#breaker.ensureClosed("delete");
    const rawId = extractRawId(id, ADAPTER_ID);
    try {
      await this.#sdk().delete(rawId);
      this.#breaker.recordSuccess();
    } catch (err) {
      throw this.#translateError(err, "delete");
    }
  }

  async history(id: MemoryId): Promise<MemoryRevision[]> {
    this.#breaker.ensureClosed("history");
    const rawId = extractRawId(id, ADAPTER_ID);
    try {
      const rows = await this.#sdk().history(rawId);
      this.#breaker.recordSuccess();
      return rows.map((r, i) => {
        const u = (r as unknown as { updatedAt?: unknown }).updatedAt;
        const changedAt =
          u instanceof Date
            ? u.toISOString()
            : typeof u === "string"
              ? u
              : new Date().toISOString();
        return {
          id: mkMemoryId(ADAPTER_ID, r.memoryId ?? rawId),
          content: String(r.newMemory ?? r.oldMemory ?? ""),
          version: i + 1,
          changedAt,
        };
      });
    } catch (err) {
      throw this.#translateError(err, "history");
    }
  }

  getToolSchemas(): MemoryToolSchema[] {
    return [
      {
        name: "memory_write",
        description:
          "Persist a turn to Mem0 long-term memory. Server-side extraction populates facts.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "Turn text to persist." },
          },
          required: ["content"],
        },
      },
      {
        name: "memory_recall",
        description: "Retrieve up to k semantically relevant facts from Mem0 (server-side rerank).",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            k: { type: "integer", minimum: 1, maximum: 50 },
          },
          required: ["query"],
        },
      },
      {
        name: "memory_history",
        description:
          "Retrieve the version history of a specific memory by id. Mem0-unique capability — " +
          "shows how a fact has evolved over time (e.g., user changed preferences).",
        parameters: {
          type: "object",
          properties: { memoryId: { type: "string" } },
          required: ["memoryId"],
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
      const id = await this.write(String(args.content ?? ""), ctx);
      return JSON.stringify({ ok: true, id });
    }
    if (name === "memory_recall") {
      const k = typeof args.k === "number" ? args.k : 10;
      const facts = await this.recall(String(args.query ?? ""), ctx, k);
      return JSON.stringify({ ok: true, facts });
    }
    if (name === "memory_history") {
      const rawId = String(args.memoryId ?? "");
      const wrapped = rawId.startsWith(`${ADAPTER_ID}:`)
        ? (rawId as MemoryId)
        : mkMemoryId(ADAPTER_ID, rawId);
      const revisions = await this.history(wrapped);
      return JSON.stringify({ ok: true, revisions });
    }
    throw new MemoryAdapterError(`Unknown tool name: ${name}`, {
      adapterId: ADAPTER_ID,
      code: "invalid_input",
    });
  }

  async shutdown(): Promise<void> {
    this.#client = undefined;
  }

  /** Test-only: inspect breaker state. @internal */
  _breakerState(): { failures: number; isOpen: boolean; openUntil: number } {
    return this.#breaker.state();
  }

  // ── helpers ────────────────────────────────────────────────────────

  #toMessages(
    content: string | MemoryTurnMessage[],
  ): Array<{ role: "user" | "assistant"; content: string }> {
    if (typeof content === "string") {
      return content.trim().length === 0 ? [] : [{ role: "user", content }];
    }
    // Mem0 SDK accepts only user/assistant roles. System turns are merged
    // into user content with a "[system] " prefix.
    return content
      .filter((m) => m.content.trim().length > 0)
      .map((m) =>
        m.role === "system"
          ? { role: "user" as const, content: `[system] ${m.content}` }
          : { role: m.role, content: m.content },
      );
  }

  #sdk(): MemoryClient {
    if (this.#client === undefined) {
      this.#client = new MemoryClient({
        apiKey: this.#opts.apiKey,
        ...(this.#opts.host !== undefined ? { host: this.#opts.host } : {}),
        ...(this.#opts.organizationId !== undefined
          ? { organizationId: this.#opts.organizationId }
          : {}),
        ...(this.#opts.projectId !== undefined ? { projectId: this.#opts.projectId } : {}),
      });
    }
    return this.#client;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: error-translation ladder maps provider error classes to typed codes + breaker policy (EC-K: 429 does NOT trip); inlining keeps the policy decisions in one place.
  #translateError(err: unknown, op: string): MemoryAdapterError {
    if (err instanceof MemoryAdapterError) {
      if (err.code === "rate_limited") {
        // EC-K: do NOT trip breaker on rate limit.
      } else if (
        err.code === "auth_failed" ||
        err.code === "not_found" ||
        err.code === "invalid_input"
      ) {
        // No trip — these are caller-side or stateful conditions.
      } else {
        this.#breaker.recordFailure();
      }
      return err;
    }
    // The real mem0ai SDK does NOT attach `.status`/`.statusCode`/`.response.status` to its
    // thrown errors (verified against mem0ai@3.0.3's `createExceptionFromResponse`, which builds
    // `RateLimitError`/`AuthenticationError`/etc. carrying only `.errorCode` as a string like
    // `"HTTP_429"`). Without this fallback, every real vendor error fell through to `status ===
    // undefined` and was misclassified as `code: "unknown"` — 429s never got the EC-K rate-limit
    // exemption and 5xx never tripped the breaker. Caught by wire-contract.test.ts running the
    // real SDK; the old hand-written `vi.mock` fabricated `.status` on its thrown errors, which
    // is why this never failed a test.
    const errorCode = (err as { errorCode?: unknown })?.errorCode;
    const statusFromErrorCode =
      typeof errorCode === "string" && /^HTTP_(\d{3})$/.test(errorCode)
        ? Number(errorCode.slice(5))
        : undefined;
    const status =
      (err as { status?: number; statusCode?: number; response?: { status?: number } })?.status ??
      (err as { statusCode?: number })?.statusCode ??
      (err as { response?: { status?: number } })?.response?.status ??
      statusFromErrorCode;
    const message = (err as Error)?.message ?? String(err);
    if (status === 401 || status === 403) {
      return new MemoryAdapterError(`Mem0 auth failed (${op}): ${message}`, {
        adapterId: ADAPTER_ID,
        code: "auth_failed",
        cause: err,
      });
    }
    if (status === 429) {
      // EC-K: rate-limited; do NOT increment breaker.
      return new MemoryAdapterError(`Mem0 rate limited (${op}): ${message}`, {
        adapterId: ADAPTER_ID,
        code: "rate_limited",
        cause: err,
      });
    }
    if (status === 404) {
      return new MemoryAdapterError(`Mem0 not found (${op}): ${message}`, {
        adapterId: ADAPTER_ID,
        code: "not_found",
        cause: err,
      });
    }
    if (typeof status === "number" && status >= 500) {
      this.#breaker.recordFailure();
      return new MemoryAdapterError(`Mem0 server error (${op}): ${message}`, {
        adapterId: ADAPTER_ID,
        code: "network",
        cause: err,
      });
    }
    if (status === undefined && message.toLowerCase().includes("network")) {
      this.#breaker.recordFailure();
      return new MemoryAdapterError(`Mem0 network error (${op}): ${message}`, {
        adapterId: ADAPTER_ID,
        code: "network",
        cause: err,
      });
    }
    return new MemoryAdapterError(`Mem0 error (${op}): ${message}`, {
      adapterId: ADAPTER_ID,
      code: "unknown",
      cause: err,
    });
  }
}
