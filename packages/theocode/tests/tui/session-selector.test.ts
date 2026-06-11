import { describe, expect, it } from "vitest";
import type { SessionListItem } from "../../src/tui/session-selector.js";
import {
  formatSessionList,
  selectNextSession,
  selectPrevSession,
} from "../../src/tui/session-selector.js";

const sessions: SessionListItem[] = [
  { id: "s1", title: "Fix login bug", updatedAt: 1718100000000, isActive: true },
  { id: "s2", title: "Add caching", updatedAt: 1718000000000, isActive: false },
  { id: "s3", title: "Refactor DB", updatedAt: 1717900000000, isActive: false },
];

describe("formatSessionList", () => {
  it("prefixes active session with >", () => {
    const lines = formatSessionList(sessions);
    expect(lines[0]).toMatch(/^> Fix login bug/);
    expect(lines[1]).toMatch(/^\s+Add caching/);
  });
});

describe("selectNextSession", () => {
  it("returns the next session in list", () => {
    expect(selectNextSession(sessions, "s1")).toBe("s2");
    expect(selectNextSession(sessions, "s3")).toBe("s1"); // wraps
  });

  it("returns null when fewer than 2 sessions", () => {
    expect(selectNextSession([sessions[0]!], "s1")).toBeNull();
  });
});

describe("selectPrevSession", () => {
  it("returns the previous session in list", () => {
    expect(selectPrevSession(sessions, "s2")).toBe("s1");
    expect(selectPrevSession(sessions, "s1")).toBe("s3"); // wraps
  });
});
