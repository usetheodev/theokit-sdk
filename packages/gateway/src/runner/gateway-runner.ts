/**
 * `GatewayRunner` — top-level orchestrator (T1.3, ADR D170+ family).
 *
 * Owns the adapter map, dispatches inbound events through the hook chain,
 * builds a per-event `GatewayContext` whose `reply` auto-routes to the
 * adapter matching `event.platform` (EC-G).
 *
 * **Lifecycle:**
 * - `start()` connects all adapters in parallel via `Promise.all`. Partial
 *   failure rolls back: connected adapters get `disconnect()`, then the
 *   aggregate error rethrows.
 * - `stop()` drains in-flight handlers up to `drainTimeoutMs` (default 10s)
 *   BEFORE disconnecting (EC-E). Idempotent.
 *
 * **Hook chain on inbound:**
 * 1. `firePreInbound({ event })`
 * 2. If `block: true` + `message`: call `ctx.reply(message)` (EC-D), short-circuit.
 * 3. If `block: true` only: short-circuit silently.
 * 4. Otherwise: call user handler.
 * 5. On handler throw: fire `on_error`, log via `Security.redact` (EC-F).
 *
 * @public
 */

import { Security } from "@usetheo/sdk";

import type { BasePlatformAdapter, SendResult } from "../adapter/base.js";
import { type GatewayHook, HookExecutor } from "../hooks/types.js";
import type { MessageEvent as GatewayMessageEvent, PlatformName } from "../types/message-event.js";

/** Per-event context passed to the user handler. */
export interface GatewayContext {
  /** Send a reply to the originating channel (auto-routed by `event.platform`). */
  reply(text: string, opts?: { format?: "plain" | "markdown" | "html" }): Promise<SendResult>;
  /** The triggering event. */
  readonly event: GatewayMessageEvent;
}

/** User-supplied handler. */
export type GatewayHandler = (event: GatewayMessageEvent, ctx: GatewayContext) => Promise<void>;

/** Runner configuration. */
export interface GatewayRunnerOptions {
  readonly adapters: ReadonlyArray<BasePlatformAdapter>;
  readonly handler: GatewayHandler;
  readonly hooks?: ReadonlyArray<GatewayHook>;
  /** Drain timeout for in-flight handlers on stop(). Default 10_000ms (EC-E). */
  readonly drainTimeoutMs?: number;
  /**
   * Prefixes that `runner.command(name, h)` matches on. Default `["/"]`
   * (Telegram-style). Pass `["!"]` for Discord, `["/", "!"]` to accept
   * both. Word-boundary match (EC-A) applies to every prefix.
   *
   * @public
   */
  readonly commandPrefixes?: ReadonlyArray<string>;
}

const DEFAULT_DRAIN_MS = 10_000;
const DEFAULT_COMMAND_PREFIXES: ReadonlyArray<string> = ["/"];

/**
 * Holds the registered adapters and dispatches inbound events through
 * the hook chain to the user handler. Use the sugar `runner.command(...)`
 * for slash command dispatch with word-boundary matching (EC-A).
 *
 * @public
 */
export class GatewayRunner {
  private readonly adaptersByPlatform = new Map<PlatformName, BasePlatformAdapter>();
  private readonly hookExecutor: HookExecutor;
  private readonly inflight = new Set<Promise<void>>();
  private readonly unsubs: Array<() => void> = [];
  /** Slash command registry: name → handler (word-boundary match, EC-A). */
  private readonly commands = new Map<string, GatewayHandler>();
  private connected = false;
  private stopped = false;

  constructor(private readonly opts: GatewayRunnerOptions) {
    for (const a of opts.adapters) this.adaptersByPlatform.set(a.platform, a);
    this.hookExecutor = new HookExecutor(opts.hooks ?? []);
  }

  /**
   * Register a slash command. Match rule (EC-A): text === "/" + name
   * OR text.startsWith("/" + name + " ") OR text.startsWith("/" + name + "@").
   *
   * @public
   */
  command(name: string, handler: GatewayHandler): void {
    this.commands.set(name, handler);
  }

  /** Connect all adapters and wire inbound dispatch. */
  async start(): Promise<void> {
    if (this.connected) return;
    const connected: BasePlatformAdapter[] = [];
    try {
      await Promise.all(
        this.opts.adapters.map(async (a) => {
          const ok = await a.connect();
          if (ok) connected.push(a);
          else throw new Error(`adapter "${a.platform}" connect returned false`);
        }),
      );
    } catch (err) {
      // Roll back partial connections.
      await Promise.all(connected.map((a) => a.disconnect().catch(() => undefined)));
      throw err;
    }

    for (const a of this.opts.adapters) {
      // Fire-and-forget: grammy / discord.js await this callback. If we
      // awaited dispatch synchronously, the platform's event loop would
      // serialize all inbound messages behind whichever handler is
      // currently running (dogfood-2026-05-21 bug). Wrap the dispatch
      // promise in `inflight` synchronously so `stop()` still drains it.
      const unsub = a.onInbound(async (event) => {
        const p = this.dispatch(event);
        this.inflight.add(p);
        p.finally(() => this.inflight.delete(p));
        // Resolve immediately so the platform's event loop continues to
        // the next update. The real handler completes via the dispatch
        // promise tracked in `inflight` (preserves EC-E drain semantics).
      });
      this.unsubs.push(unsub);
    }
    this.connected = true;
  }

  /**
   * Stop the runner. Drains in-flight handlers up to `drainTimeoutMs`,
   * then disconnects adapters. Idempotent (EC-E).
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    for (const unsub of this.unsubs) {
      try {
        unsub();
      } catch {
        /* ignore */
      }
    }
    this.unsubs.length = 0;

    const drainMs = this.opts.drainTimeoutMs ?? DEFAULT_DRAIN_MS;
    if (this.inflight.size > 0) {
      await Promise.race([
        Promise.all([...this.inflight]).then(() => undefined),
        new Promise<void>((r) => setTimeout(r, drainMs)),
      ]);
    }

    await Promise.all(
      [...this.adaptersByPlatform.values()].map((a) => a.disconnect().catch(() => undefined)),
    );
    this.connected = false;
  }

  /** @internal */
  private async dispatch(event: GatewayMessageEvent): Promise<void> {
    const ctx = this.buildContext(event);

    // 1. pre_inbound hooks (EC-D auto-reply on block+message).
    const decision = await this.hookExecutor.firePreInbound({ event });
    if (decision.block === true) {
      if (decision.message !== undefined && decision.message.length > 0) {
        await ctx.reply(decision.message).catch(() => undefined);
      }
      return;
    }

    // 2. Slash command dispatch with word-boundary match (EC-A).
    const slashHandler = this.matchSlashCommand(event);
    const handler = slashHandler ?? this.opts.handler;

    // 3. Run handler with try/catch → on_error + redacted log (EC-F).
    // Note: dispatch DOES await the work internally so the dispatch promise
    // tracks completion (EC-E drain). The fire-and-forget happens at the
    // CALLER level (start()'s onInbound wrapper) so grammy/discord.js are
    // not serialized — see D192 (2026-05-21 dogfood discovery).
    const work = (async () => {
      try {
        await handler(event, ctx);
      } catch (err) {
        await this.hookExecutor.fireOnError({ event, error: err as Error });
        process.stderr.write(
          `[gateway] handler error: ${Security.redact((err as Error).message)}\n`,
        );
      }
    })();
    this.inflight.add(work);
    work.finally(() => this.inflight.delete(work));
    await work;
  }

  /**
   * EC-A: word-boundary slash command match. Prevents `/skill` from
   * shadowing `/skills`. Returns the handler if a command matches,
   * undefined otherwise.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: prefix-scan + word-boundary loop is one cohesive matcher; splitting hurts readability.
  private matchSlashCommand(event: GatewayMessageEvent): GatewayHandler | undefined {
    const text = event.text;
    const prefixes = this.opts.commandPrefixes ?? DEFAULT_COMMAND_PREFIXES;
    let activePrefix: string | undefined;
    for (const p of prefixes) {
      if (text.startsWith(p)) {
        activePrefix = p;
        break;
      }
    }
    if (activePrefix === undefined) return undefined;

    for (const [name, handler] of this.commands) {
      const full = `${activePrefix}${name}`;
      if (text === full) return handler;
      if (text.startsWith(`${full} `)) return handler;
      if (text.startsWith(`${full}@`)) return handler;
    }
    return undefined;
  }

  /** EC-G: per-event ctx whose reply routes to the matching adapter. */
  private buildContext(event: GatewayMessageEvent): GatewayContext {
    const adapter = this.adaptersByPlatform.get(event.platform);
    return {
      event,
      reply: async (text, opts) => {
        if (adapter === undefined) {
          return {
            ok: false,
            error: { code: "no_adapter", message: `no adapter for ${event.platform}` },
          };
        }
        return adapter.sendMessage({
          channel: event.channel,
          text,
          ...(opts?.format !== undefined ? { format: opts.format } : {}),
        });
      },
    };
  }
}
