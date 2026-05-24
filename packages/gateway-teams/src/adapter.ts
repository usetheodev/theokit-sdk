/**
 * `TeamsAdapter` — Microsoft Teams platform adapter for `@usetheo/gateway`
 * (Adoption Roadmap v1.4 #3; ADRs D315-D326).
 *
 * Built on the modern `@microsoft/teams.apps` v2 SDK (D315). The SDK handles
 * JWT validation (D319) and exposes an `ExpressAdapter` (D316/D326) that we
 * surface via `getExpressAdapter()` so the user can mount routes into their
 * own Express server.
 *
 * Send uses the SDK's `app.send(conversationId, activity)` (string id, not a
 * ConversationReference object — D325 inspection finding). No internal
 * conversation-reference store needed; the SDK manages routing internally.
 *
 * @public
 */

import {
  BasePlatformAdapter,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
  type TeamsMessageEvent,
} from "@usetheo/gateway";

import { mapTeamsError } from "./errors.js";
import { normalizeTeamsActivity } from "./normalize.js";
import { splitForTeams } from "./split.js";
import type { TeamsAdapterOptions } from "./types.js";

/** Minimal shape of `@microsoft/teams.apps` `App` we use. Lazy-typed to avoid hard import. */
interface TeamsAppLike {
  initialize(): Promise<void>;
  start(port?: number | string): Promise<void>;
  stop(): Promise<void>;
  send(conversationId: string, activity: { type: "message"; text: string }): Promise<{ id: string }>;
  on(name: "activity", cb: (event: unknown) => void | Promise<void>): void;
  on(name: string, cb: (event: unknown) => void | Promise<void>): void;
  // ExpressAdapter or other httpServerAdapter — opaque escape hatch.
  readonly server?: unknown;
  readonly http?: unknown;
}

/**
 * Internal factory — created here so tests can inject a fake via
 * `TeamsAdapterOptions.__appFactory`. Production uses dynamic ESM import
 * of `@microsoft/teams.apps` (`new App({...})`) — lazy because the SDK
 * pulls in ~30 MB and we only want that paid when this adapter is used.
 *
 * @internal
 */
async function createDefaultTeamsApp(opts: {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  httpServerAdapter?: unknown;
}): Promise<TeamsAppLike> {
  // Dynamic import — peer dep is required to be installed at runtime.
  // EC-1 caught at construction; here we just propagate SDK init errors.
  const mod = (await import("@microsoft/teams.apps")) as {
    App: new (cfg: unknown) => TeamsAppLike;
    ExpressAdapter?: new (app?: unknown) => unknown;
  };
  return new mod.App({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    tenantId: opts.tenantId,
    httpServerAdapter: opts.httpServerAdapter,
    // SDK built-in mention stripping (D321 + EC-9 made free).
    activity: { mentions: { stripText: true } },
  });
}

export class TeamsAdapter extends BasePlatformAdapter {
  readonly platform = "teams" as const;
  private readonly opts: TeamsAdapterOptions;
  private app: TeamsAppLike | undefined;
  private handler?: (event: GatewayMessageEvent) => Promise<void>;
  private connected = false;
  // EC-5 downgraded after Phase 0: we don't need conversation refs (SDK manages),
  // but we keep a bounded Set of seen conversation ids for debug telemetry.
  private readonly seenConversations = new Set<string>();
  private static readonly MAX_SEEN_CONVERSATIONS = 1000;

  constructor(opts: TeamsAdapterOptions) {
    super();
    // EC-1: validate non-empty strings at construction (fail fast).
    for (const k of ["clientId", "clientSecret", "tenantId"] as const) {
      const v = opts[k];
      if (typeof v !== "string" || v.length === 0) {
        throw new TypeError(
          `TeamsAdapter: ${k} is required and must be a non-empty string`,
        );
      }
    }
    this.opts = opts;
  }

  /** Escape hatch (D180-style) for advanced SDK features (Adaptive Cards, message extensions). */
  getApp(): unknown {
    return this.app;
  }

  /** Returns the SDK's HTTP-server adapter for mounting into a user-provided Express app (D326). */
  getExpressAdapter(): unknown {
    return this.app?.http ?? this.app?.server;
  }

  async connect(): Promise<boolean> {
    if (this.connected && this.app !== undefined) return true;
    try {
      const factory =
        (this.opts.__appFactory as ((o: unknown) => Promise<TeamsAppLike> | TeamsAppLike) | undefined) ??
        ((o: unknown) =>
          createDefaultTeamsApp(
            o as { clientId: string; clientSecret: string; tenantId: string; httpServerAdapter?: unknown },
          ));
      this.app = await Promise.resolve(
        factory({
          clientId: this.opts.clientId,
          clientSecret: this.opts.clientSecret,
          tenantId: this.opts.tenantId,
          httpServerAdapter: this.opts.httpServerAdapter,
        }),
      );
      this.app.on("activity", (event) => {
        void this._dispatchActivity(event);
      });
      await this.app.initialize();
      this.connected = true;
      return true;
    } catch (err) {
      // EC-7 / D172: connect MUST NOT throw on platform errors.
      console.error(
        "[teams] connect failed:",
        err instanceof Error ? err.message : err,
      );
      this.app = undefined;
      this.connected = false;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.app !== undefined) {
      try {
        await this.app.stop();
      } catch {
        /* swallow — disconnect must not throw */
      }
    }
    this.app = undefined;
    this.connected = false;
    this.handler = undefined;
    this.seenConversations.clear();
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return {
        ok: false,
        error: { code: "empty_text", message: "Empty text rejected." },
      };
    }
    if (!this.connected || this.app === undefined) {
      return {
        ok: false,
        error: { code: "not_connected", message: "TeamsAdapter not connected." },
      };
    }
    const parts = splitForTeams(out.text);
    if (parts.length === 0) {
      return {
        ok: false,
        error: { code: "empty_text", message: "Text reduced to zero parts after splitting." },
      };
    }
    let lastActivityId: string | undefined;
    for (const part of parts) {
      try {
        const result = await this.app.send(out.channel.id, { type: "message", text: part });
        lastActivityId = result?.id;
      } catch (err) {
        return { ok: false, error: mapTeamsError(err) };
      }
    }
    return lastActivityId !== undefined
      ? { ok: true, messageId: lastActivityId }
      : { ok: true };
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // EC-H: replace any previous subscription.
    this.handler = handler;
    return () => {
      this.handler = undefined;
    };
  }

  /** @internal — receives an SDK activity event; normalizes + dispatches. */
  private async _dispatchActivity(rawEvent: unknown): Promise<void> {
    if (this.handler === undefined) return;
    // Extract the activity from the event envelope. SDK shape:
    //   IActivityEvent { token, activity, conversationReference?, ... }
    // We accept either shape (event with .activity OR a plain activity).
    const env = rawEvent as { activity?: unknown } | undefined;
    const activity = (env?.activity ?? rawEvent) as
      | { type?: string; conversation?: { id?: string } }
      | undefined;
    if (activity === undefined || activity.type !== "message") return;

    const event = normalizeTeamsActivity(activity, this.opts.botDisplayName);
    // EC-5 (downgraded): bound the seen-conversations Set.
    const convId = activity.conversation?.id;
    if (typeof convId === "string" && convId.length > 0) {
      if (this.seenConversations.size >= TeamsAdapter.MAX_SEEN_CONVERSATIONS) {
        const first = this.seenConversations.values().next().value;
        if (first !== undefined) this.seenConversations.delete(first);
      }
      this.seenConversations.add(convId);
    }
    await this.handler(event);
  }

  /** Test seam — current seen-conversation count. @internal */
  get _seenConversationsSize(): number {
    return this.seenConversations.size;
  }
}

export type { TeamsMessageEvent };
