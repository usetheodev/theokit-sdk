/**
 * Tests for translate.ts — containerTag building + EC-C sanitization.
 */

import { MemoryAdapterError } from "@theokit/sdk";
import { describe, expect, it } from "vitest";

import { buildContainerTags, primaryContainerTag, sanitizeIdentifier } from "../src/translate.js";

describe("translate.ts (T3.2)", () => {
  it("buildContainerTags: minimal userId only", () => {
    const tags = buildContainerTags({ userId: "alice" }, "theokit");
    expect(tags).toEqual(["theokit:user:alice"]);
  });

  it("buildContainerTags: all fields populate the tag set", () => {
    const tags = buildContainerTags(
      { userId: "alice", agentId: "coder", tenantId: "acme", tags: ["jazz", "music"] },
      "theokit",
    );
    expect(tags).toEqual([
      "theokit:user:alice",
      "theokit:agent:coder",
      "theokit:tenant:acme",
      "theokit:tag:jazz",
      "theokit:tag:music",
    ]);
  });

  // EC-C: identifier sanitizer rejects unsafe inputs
  it("EC-C: throws on userId containing colon (would corrupt tag scheme)", () => {
    expect(() => buildContainerTags({ userId: "user:123" }, "theokit")).toThrow(MemoryAdapterError);
    try {
      buildContainerTags({ userId: "user:123" }, "theokit");
    } catch (err) {
      expect((err as MemoryAdapterError).code).toBe("invalid_input");
      expect((err as MemoryAdapterError).adapterId).toBe("supermemory");
    }
  });

  it("EC-C: throws on agentId with whitespace", () => {
    expect(() => buildContainerTags({ userId: "alice", agentId: "my agent" }, "theokit")).toThrow(
      MemoryAdapterError,
    );
  });

  it("EC-C: throws on empty userId", () => {
    expect(() => buildContainerTags({ userId: "" }, "theokit")).toThrow(MemoryAdapterError);
  });

  it("primaryContainerTag returns the user namespace tag", () => {
    expect(primaryContainerTag({ userId: "alice" }, "theokit")).toBe("theokit:user:alice");
  });

  it("sanitizeIdentifier accepts underscores and dashes", () => {
    expect(sanitizeIdentifier("user_id-42", "test")).toBe("user_id-42");
  });

  it("sanitizeIdentifier rejects dots", () => {
    expect(() => sanitizeIdentifier("user.id", "test")).toThrow(MemoryAdapterError);
  });
});
