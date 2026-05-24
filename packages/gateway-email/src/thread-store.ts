/**
 * Thread context store (ADR D337). Records `{subject, references, lastMessageId}`
 * per inbound `Message-ID`; consumed on outbound to reconstruct threading headers.
 *
 * Capped at 1000 entries with FIFO eviction (matches WhatsApp / Teams pattern).
 *
 * @internal
 */

import type { EmailMessageEvent } from "@usetheo/gateway";

/** Sentinel runtime export — workaround for rollup-plugin-dts deep type-only re-export bug. */
export const __threadStoreMarker: unique symbol = Symbol("thread-store");

export interface ThreadContext {
  readonly subject: string;
  readonly references: readonly string[];
  readonly lastMessageId: string;
}

export class ThreadStore {
  private readonly map = new Map<string, ThreadContext>();
  static readonly MAX_SIZE = 1000;

  recordFromInbound(event: EmailMessageEvent): void {
    const ctx: ThreadContext = {
      subject: event.email.subject,
      references: event.email.references ?? [],
      lastMessageId: event.email.messageId,
    };
    // FIFO eviction.
    if (this.map.size >= ThreadStore.MAX_SIZE && !this.map.has(event.email.messageId)) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.delete(event.email.messageId);
    this.map.set(event.email.messageId, ctx);
  }

  lookup(topicId: string): ThreadContext | undefined {
    return this.map.get(topicId);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
