import { describe, expect, it } from "vitest";

import { detectChannelType } from "../src/room-state.js";
import type { MatrixRoomLike } from "../src/types.js";

function makeRoom(memberCount: number, roomId = "!r:server"): MatrixRoomLike {
  return {
    roomId,
    getJoinedMemberCount: () => memberCount,
  };
}

describe("detectChannelType (D416)", () => {
  it("2 members → dm", () => {
    expect(detectChannelType(makeRoom(2))).toBe("dm");
  });

  it("3 members → group", () => {
    expect(detectChannelType(makeRoom(3))).toBe("group");
  });

  it("10 members → group", () => {
    expect(detectChannelType(makeRoom(10))).toBe("group");
  });

  it("1 member (lone bot) → group", () => {
    expect(detectChannelType(makeRoom(1))).toBe("group");
  });

  it("undefined room → group (safe default)", () => {
    expect(detectChannelType(undefined)).toBe("group");
  });
});
