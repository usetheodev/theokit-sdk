/**
 * Room state helpers (D416).
 *
 * Matrix has no native "DM" concept — DMs are rooms with 2 members.
 * The canonical heuristic: `member_count === 2 → "dm"`, else `"group"`.
 */

import type { MatrixRoomLike } from "./types.js";

export function detectChannelType(room: MatrixRoomLike | undefined): "dm" | "group" {
  if (room === undefined) return "group";
  return room.getJoinedMemberCount() === 2 ? "dm" : "group";
}
