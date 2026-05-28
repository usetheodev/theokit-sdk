import { describe, expect, it } from "vitest";

import { matrixEventToMessageEvent } from "../src/normalize.js";
import type { MatrixEventLike, MatrixRoomLike } from "../src/types.js";

function makeEvent(
  opts?: Partial<{
    id: string;
    sender: string;
    type: string;
    body: string;
    ts: number;
  }>,
): MatrixEventLike {
  return {
    getId: () => opts?.id ?? "evt-1",
    getSender: () => opts?.sender ?? "@alice:matrix.org",
    getRoomId: () => "!r:server",
    getType: () => opts?.type ?? "m.room.message",
    getContent: () => ({ body: opts?.body ?? "hello", msgtype: "m.text" }),
    getTs: () => opts?.ts ?? 1700000000,
  };
}

function makeRoom(memberCount: number): MatrixRoomLike {
  return { roomId: "!r:server", getJoinedMemberCount: () => memberCount };
}

describe("matrixEventToMessageEvent", () => {
  it("DM (2 members) → channel.type=dm", () => {
    const event = matrixEventToMessageEvent(makeEvent(), makeRoom(2));
    expect(event?.platform).toBe("matrix");
    expect(event?.channel.type).toBe("dm");
    expect(event?.sender.id).toBe("@alice:matrix.org");
  });

  it("Group (5 members) → channel.type=group", () => {
    const event = matrixEventToMessageEvent(makeEvent(), makeRoom(5));
    expect(event?.channel.type).toBe("group");
  });

  it("returns undefined when event id missing", () => {
    const event = matrixEventToMessageEvent(
      {
        ...makeEvent(),
        getId: () => undefined,
      },
      makeRoom(2),
    );
    expect(event).toBeUndefined();
  });

  it("returns undefined when sender missing", () => {
    const event = matrixEventToMessageEvent(
      {
        ...makeEvent(),
        getSender: () => undefined,
      },
      makeRoom(2),
    );
    expect(event).toBeUndefined();
  });

  it("preserves text body", () => {
    const event = matrixEventToMessageEvent(makeEvent({ body: "hi from alice" }), makeRoom(2));
    expect(event?.text).toBe("hi from alice");
  });

  it("populates matrix.memberCount + raw escape hatch (D421)", () => {
    const raw = makeEvent();
    const event = matrixEventToMessageEvent(raw, makeRoom(7));
    if (event?.platform === "matrix") {
      expect(event.matrix.memberCount).toBe(7);
      expect(event.matrix.raw).toBe(raw);
      expect(event.matrix.roomId).toBe("!r:server");
    } else {
      throw new Error("expected matrix event");
    }
  });

  it("handles missing body (media event with no caption)", () => {
    const event = matrixEventToMessageEvent(
      {
        ...makeEvent(),
        getContent: () => ({ msgtype: "m.image" }),
      },
      makeRoom(2),
    );
    expect(event?.text).toBe("");
  });
});
