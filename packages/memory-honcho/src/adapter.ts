/**
 * HonchoAdapter — `@theokit/memory-honcho` core (T4.1, ADR D141).
 *
 * Wraps `@honcho-ai/sdk@^2`. Implements `MemoryAdapter` over Honcho's
 * peer + session model with a dialectic-reasoning flavor of recall
 * (`peer.chat()` returns ONE synthesized answer, not k facts — EC-J).
 *
 * @public
 */

import { Honcho } from "@honcho-ai/sdk";
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

import { honchoPeerKey, honchoSessionKey } from "./translate.js";

/**
 * Configuration accepted by the `honchoMemory(...)` factory.
 *
 * @public
 */
export interface HonchoAdapterOptions {
  /**
   * Honcho API key, forwarded verbatim to `new Honcho({ apiKey })`.
   *
   * REQUIRED by this type. `@honcho-ai/sdk` itself falls back to `HONCHO_API_KEY` when the value
   * it receives is `undefined`, so passing `process.env.HONCHO_API_KEY!` and passing nothing
   * reach the same place inside the vendor client — but this adapter's `isAvailable()` reports
   * `false` for an empty or missing key, and nothing constructs the client until the first
   * `write` / `recall`. An absent key therefore surfaces as a
   * `MemoryAdapterError(code: "auth_failed")` on the first call, not at `Agent.create` time.
   */
  apiKey: string;
  /**
   * Honcho workspace to write into. Forwarded only when set.
   *
   * When omitted, `@honcho-ai/sdk` resolves `HONCHO_WORKSPACE_ID` and finally the literal
   * `"default"` workspace — so leaving this out is never an error, it silently picks a workspace.
   */
  workspaceId?: string;
  /**
   * Base URL for a self-hosted Honcho, forwarded as the vendor's `baseURL`.
   *
   * Omit it for Honcho cloud; the vendor then reads `HONCHO_URL` and falls back to its own
   * production URL.
   */
  baseUrl?: string;
}

const ADAPTER_ID = "honcho";

const CAPS: MemoryAdapterCapabilities = {
  history: false,
  sessions: true,
  tenancy: true,
  reasoning: true,
  toolSchemas: true,
  prefetch: false,
};

/**
 * Honcho adapter. Construct via `honchoMemory(...)` factory from
 * `./index.ts`, not directly.
 *
 * @internal
 */
export class HonchoAdapter implements MemoryAdapter {
  readonly id = ADAPTER_ID;
  readonly capabilities = CAPS;
  readonly #opts: HonchoAdapterOptions;
  #client?: Honcho;

  constructor(opts: HonchoAdapterOptions) {
    this.#opts = opts;
  }

  isAvailable(): boolean {
    return typeof this.#opts.apiKey === "string" && this.#opts.apiKey.length > 0;
  }

  async initialize(): Promise<void> {
    // Lazy: client constructed on first call.
  }

  async write(content: string | MemoryTurnMessage[], ctx: MemoryContext): Promise<MemoryId> {
    const text = this.#renderContent(content);
    if (text.length === 0) {
      throw new MemoryAdapterError("write: empty content", {
        adapterId: ADAPTER_ID,
        code: "invalid_input",
      });
    }
    try {
      const peer = await this.#sdk().peer(honchoPeerKey(ctx));
      const session = await this.#sdk().session(honchoSessionKey(ctx));
      await session.addPeers([peer]);
      const messages = await session.addMessages([peer.message(text)]);
      const first = messages[0];
      const rawId = (first as unknown as { id?: string })?.id ?? `msg-${Date.now()}`;
      return mkMemoryId(ADAPTER_ID, rawId);
    } catch (err) {
      throw this.#translateError(err, "write");
    }
  }

  async recall(query: string, ctx: MemoryContext, k = 1): Promise<MemoryFact[]> {
    if (k <= 0) return [];
    try {
      const peer = await this.#sdk().peer(honchoPeerKey(ctx));
      // EC-J: Honcho returns synthesized reasoning, NOT a list of facts.
      // We wrap as a single high-score fact and document this in the tool
      // schema so the LLM treats it as a reasoned summary.
      const sessionKey = honchoSessionKey(ctx);
      const session = await this.#sdk().session(sessionKey);
      const answer = await peer.chat(query, { session });
      if (answer === null || answer.trim().length === 0) return [];
      return [
        {
          id: mkMemoryId(ADAPTER_ID, `chat-${Date.now()}`),
          content: answer,
          score: 1.0,
        },
      ];
    } catch (err) {
      throw this.#translateError(err, "recall");
    }
  }

  async delete(id: MemoryId): Promise<void> {
    // Honcho 2 does not expose a public delete-message HTTP method; the
    // closest is message archival via metadata. We throw `not_found` to
    // make the constraint explicit instead of silently succeeding.
    extractRawId(id, ADAPTER_ID); // EC-B prefix validation still applies
    throw new MemoryAdapterError(
      "Honcho adapter: message delete is not supported by @honcho-ai/sdk v2.",
      { adapterId: ADAPTER_ID, code: "invalid_input" },
    );
  }

  getToolSchemas(): MemoryToolSchema[] {
    return [
      {
        name: "memory_write",
        description:
          "Persist a user/assistant turn to Honcho long-term memory. " +
          "Returns the stored message ID.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "Turn text to persist verbatim." },
          },
          required: ["content"],
        },
      },
      {
        name: "memory_recall",
        description:
          // EC-J: explicit semantic — this is a reasoning answer, not facts.
          "Retrieve a synthesized reasoning answer about the user from Honcho's " +
          "dialectic memory. Returns ONE result containing a natural-language " +
          "answer (not a list of raw facts). Use for open-ended questions like " +
          "'What does the user know about X?'.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Natural-language question." },
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
      const id = await this.write(String(args.content ?? ""), ctx);
      return JSON.stringify({ ok: true, id });
    }
    if (name === "memory_recall") {
      const facts = await this.recall(String(args.query ?? ""), ctx);
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

  #renderContent(content: string | MemoryTurnMessage[]): string {
    if (typeof content === "string") return content.trim();
    return content
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n")
      .trim();
  }

  #sdk(): Honcho {
    if (this.#client === undefined) {
      this.#client = new Honcho({
        apiKey: this.#opts.apiKey,
        ...(this.#opts.workspaceId !== undefined ? { workspaceId: this.#opts.workspaceId } : {}),
        ...(this.#opts.baseUrl !== undefined ? { baseURL: this.#opts.baseUrl } : {}),
      });
    }
    return this.#client;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: error-translation ladder is exhaustive — each branch maps one provider-class error to one typed MemoryAdapterError code; splitting hurts traceability.
  #translateError(err: unknown, op: string): MemoryAdapterError {
    if (err instanceof MemoryAdapterError) return err;
    const status =
      (err as { status?: number; statusCode?: number })?.status ??
      (err as { statusCode?: number })?.statusCode;
    const message = (err as Error)?.message ?? String(err);
    const errorName = (err as Error)?.name ?? "";
    if (status === 401 || status === 403 || errorName === "AuthenticationError") {
      return new MemoryAdapterError(`Honcho auth failed (${op}): ${message}`, {
        adapterId: ADAPTER_ID,
        code: "auth_failed",
        cause: err,
      });
    }
    if (status === 429 || errorName === "RateLimitError") {
      return new MemoryAdapterError(`Honcho rate limited (${op}): ${message}`, {
        adapterId: ADAPTER_ID,
        code: "rate_limited",
        cause: err,
      });
    }
    if (status === 404 || errorName === "NotFoundError") {
      return new MemoryAdapterError(`Honcho not found (${op}): ${message}`, {
        adapterId: ADAPTER_ID,
        code: "not_found",
        cause: err,
      });
    }
    if (errorName === "ConnectionError" || errorName === "TimeoutError") {
      return new MemoryAdapterError(`Honcho network error (${op}): ${message}`, {
        adapterId: ADAPTER_ID,
        code: "network",
        cause: err,
      });
    }
    return new MemoryAdapterError(`Honcho error (${op}): ${message}`, {
      adapterId: ADAPTER_ID,
      code: "unknown",
      cause: err,
    });
  }
}
