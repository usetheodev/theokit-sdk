/**
 * Test helper — minimal in-memory adapter for runner/hook tests.
 * Not exported from the package; lives in tests/ only.
 */

import {
  BasePlatformAdapter,
  type OutboundMessage,
  type SendResult,
} from "../../src/adapter/base.js";
import type { MessageEvent, PlatformName } from "../../src/types/message-event.js";

export class MockAdapter extends BasePlatformAdapter {
  readonly platform: PlatformName;
  connected = false;
  connectCount = 0;
  disconnectCount = 0;
  sent: OutboundMessage[] = [];
  /** Force sendMessage to return error on next call. */
  failNextSend?: { code: string; message: string };
  private handler?: (event: MessageEvent) => Promise<void>;

  constructor(platform: PlatformName = "telegram") {
    super();
    this.platform = platform;
  }

  override async connect(): Promise<boolean> {
    this.connectCount += 1;
    this.connected = true;
    return true;
  }

  override async disconnect(): Promise<void> {
    this.disconnectCount += 1;
    this.connected = false;
  }

  override async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "text is empty" } };
    }
    if (this.failNextSend !== undefined) {
      const err = this.failNextSend;
      this.failNextSend = undefined;
      return { ok: false, error: err };
    }
    this.sent.push(out);
    return { ok: true, messageId: `mock-${this.sent.length}` };
  }

  override onInbound(handler: (event: MessageEvent) => Promise<void>): () => void {
    // EC-H: replace previous handler.
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  /** Test helper: simulate an inbound event. */
  async emit(event: MessageEvent): Promise<void> {
    if (this.handler !== undefined) await this.handler(event);
  }
}
