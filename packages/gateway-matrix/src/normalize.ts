/**
 * Inbound normalization: MatrixEvent + Room → MatrixMessageEvent.
 *
 * @public
 */

import type { MatrixMessageEvent } from "@usetheo/gateway";

import { detectChannelType } from "./room-state.js";
import type { MatrixEventLike, MatrixRoomLike } from "./types.js";

export function matrixEventToMessageEvent(
  event: MatrixEventLike,
  room: MatrixRoomLike,
): MatrixMessageEvent | undefined {
  const eventId = event.getId();
  const sender = event.getSender();
  if (eventId === undefined || sender === undefined) return undefined;
  const channelType = detectChannelType(room);
  const content = event.getContent();
  const body = content.body ?? "";
  return {
    id: eventId,
    platform: "matrix",
    sender: { id: sender },
    channel: {
      id: room.roomId,
      type: channelType,
    },
    text: body,
    receivedAt: event.getTs(),
    matrix: {
      roomId: room.roomId,
      eventId,
      memberCount: room.getJoinedMemberCount(),
      raw: event,
    },
  };
}
