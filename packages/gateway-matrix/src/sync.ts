/**
 * Sync timeline filter (D415, EC-3 absorbed).
 *
 * Wraps `client.on("Room.timeline", listener)` with 3 filters:
 *
 * 1. Drop non-`m.room.message` events (D413).
 * 2. Drop bot's own messages (loop guard, D275 mirror).
 * 3. **EC-3**: drop events older than `freshnessWindowMs` (default 60s)
 *    — initial sync from `matrix-js-sdk` delivers ~10 historical events
 *    per joined room, which would otherwise trigger an LLM-call storm.
 */

import type { MatrixEventLike, MatrixRoomLike } from "./types.js";

export interface SyncFilterOpts {
  readonly botUserId: string;
  readonly freshnessWindowMs: number;
}

export function shouldDispatchSyncEvent(
  event: MatrixEventLike,
  opts: SyncFilterOpts,
  now = Date.now(),
): boolean {
  if (event.getType() !== "m.room.message") return false;
  const sender = event.getSender();
  if (sender === opts.botUserId) return false;
  if (event.getTs() < now - opts.freshnessWindowMs) return false;
  return true;
}

export interface TimelineSubscription {
  unsubscribe(): void;
}

export interface MatrixClientLike {
  on(event: "Room.timeline", listener: (e: MatrixEventLike, r: MatrixRoomLike) => void): void;
  off(event: "Room.timeline", listener: (e: MatrixEventLike, r: MatrixRoomLike) => void): void;
}

export function subscribeToTimeline(
  client: MatrixClientLike,
  handler: (event: MatrixEventLike, room: MatrixRoomLike) => void,
  opts: SyncFilterOpts,
): TimelineSubscription {
  const wrapped = (event: MatrixEventLike, room: MatrixRoomLike): void => {
    if (!shouldDispatchSyncEvent(event, opts)) return;
    handler(event, room);
  };
  client.on("Room.timeline", wrapped);
  return {
    unsubscribe(): void {
      client.off("Room.timeline", wrapped);
    },
  };
}
