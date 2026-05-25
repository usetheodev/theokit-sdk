/**
 * `SlackAdapter` — Slack platform adapter for `@usetheo/gateway` (Adoption
 * Roadmap #7; ADRs D267-D285).
 *
 * Transport: Socket Mode via `@slack/bolt` (D267, D268).
 * Inbound: normalized to `SlackMessageEvent` (D274) with bot-loop guard (D275)
 * and mention-required default for public channels (D285).
 * Outbound: `chat.postMessage` with 4000-char split (D272) + canonical
 * `SendResult` error mapping (D273).
 *
 * @public
 */

// @slack/bolt v3 is CommonJS-only; named ESM `import { App }` fails at
// runtime. Use default import + destructure (Node CJS-interop via
// esModuleInterop in tsconfig.base).
import bolt from "@slack/bolt";

const { App } = bolt;
type App = InstanceType<typeof App>;

import {
  BasePlatformAdapter,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@usetheo/gateway";

import { mapSlackError } from "./errors.js";
import { type BoltMessageBody, normalizeSlackEvent } from "./normalize.js";
import { splitForSlack } from "./split.js";

export interface SlackAdapterOptions {
  /** xoxb-... Bot User OAuth token. */
  readonly botToken: string;
  /** xapp-... App-Level token with `connections:write` scope. */
  readonly appToken: string;
  /** D269: only `"socket"` is supported in v1. */
  readonly transport?: "socket";
  /** D285: when `true` (default), public-channel messages without `@bot` are dropped. */
  readonly requireMention?: boolean;
  /** Bolt log level — passed straight to the underlying App. */
  readonly logLevel?: "debug" | "info" | "warn" | "error";
}

export class SlackAdapter extends BasePlatformAdapter {
  readonly platform = "slack" as const;
  private app: App | undefined;
  private connected = false;
  private botUserId: string | undefined;
  private handler?: (event: GatewayMessageEvent) => Promise<void>;
  // EC-2: serialize concurrent connect() calls so they share one in-flight start.
  private connectingPromise?: Promise<boolean>;

  constructor(private readonly opts: SlackAdapterOptions) {
    super();
  }

  /** Escape hatch for advanced Bolt features (Block Kit, slash commands, modals). */
  getApp(): App | undefined {
    return this.app;
  }

  /** Cached bot user id (resolved via `auth.test` on connect, D277). */
  getBotUserId(): string | undefined {
    return this.botUserId;
  }

  override async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (this.connectingPromise !== undefined) return this.connectingPromise;
    this.connectingPromise = this._doConnect().finally(() => {
      this.connectingPromise = undefined;
    });
    return this.connectingPromise;
  }

  private async _doConnect(): Promise<boolean> {
    try {
      this.app = new App({
        token: this.opts.botToken,
        appToken: this.opts.appToken,
        socketMode: true,
        ...(this.opts.logLevel !== undefined
          ? // biome-ignore lint/suspicious/noExplicitAny: Bolt's LogLevel enum is a runtime const
            { logLevel: this.opts.logLevel as any }
          : {}),
      });
      this.app.event("message", async (args) => this.handleMessage(args));
      await this.app.start();
      // D277: cache botUserId via auth.test for loop guard.
      const auth = await this.app.client.auth.test();
      this.botUserId = String(auth.user_id ?? "");
      this.connected = true;
      return true;
    } catch (err) {
      // D279 / EC-1: never throw; clean up orphan App if start() succeeded but auth.test failed.
      process.stderr.write(
        `[slack-adapter] connect failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      if (this.app !== undefined) {
        await this.app.stop().catch(() => undefined);
      }
      this.app = undefined;
      this.botUserId = undefined;
      return false;
    }
  }

  override async disconnect(): Promise<void> {
    // D278: idempotent + safe before connect.
    if (!this.connected || this.app === undefined) return;
    try {
      await this.app.stop();
    } catch (err) {
      process.stderr.write(
        `[slack-adapter] disconnect error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    this.app = undefined;
    this.connected = false;
    this.botUserId = undefined;
  }

  override async sendMessage(out: OutboundMessage): Promise<SendResult> {
    // EC-6: also gate on `connected` — `this.app` is set synchronously before
    // `app.start()` completes, so a send in-between would otherwise leak through.
    if (this.app === undefined || !this.connected) {
      return {
        ok: false,
        error: { code: "not_connected", message: "adapter not connected" },
      };
    }
    if (out.text.length === 0) {
      return {
        ok: false,
        error: { code: "empty_text", message: "text is empty" },
      };
    }

    const chunks = splitForSlack(out.text);
    let lastId: string | undefined;
    for (const chunk of chunks) {
      try {
        const resp = await this.app.client.chat.postMessage({
          channel: out.channel.id,
          text: chunk,
          ...(out.channel.topicId !== undefined ? { thread_ts: out.channel.topicId } : {}),
          // D281: plain | markdown only; Block Kit deferred to v1.x.
          ...(out.format === "markdown" ? { mrkdwn: true } : {}),
        });
        lastId = typeof resp.ts === "string" ? resp.ts : undefined;
      } catch (err) {
        return mapSlackError(err);
      }
    }
    return { ok: true, ...(lastId !== undefined ? { messageId: lastId } : {}) };
  }

  override onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // D276 / EC-H: second call replaces previous.
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  private async handleMessage(args: { body: unknown }): Promise<void> {
    if (this.handler === undefined) return;
    const event = normalizeSlackEvent(args.body as BoltMessageBody, this.botUserId, {
      requireMention: this.opts.requireMention ?? true,
    });
    if (event === undefined) return;
    try {
      await this.handler(event);
    } catch (err) {
      process.stderr.write(
        `[slack-adapter] handler threw: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}
