/**
 * M3 #62 — scoped session id helpers (app:/user:/temp:). SE40 (v4.0) removed the
 * `ConversationStorageAdapter` (and its `deleteScope`), so the scope surface is now
 * the pure id-composition helpers that survive on the public barrel; scope pruning
 * against a store is no longer part of the SDK.
 */
import { describe, expect, it } from "vitest";
import { scopedConversationId, sessionScopePrefix } from "../../../src/session-scope.js";

describe("M3 #62 — scoped session id helpers", () => {
  it("scopedConversationId prefixes the base id per scope", () => {
    expect(scopedConversationId("app", "c")).toBe("app__c");
    expect(scopedConversationId("user", "c")).toBe("user__c");
    expect(scopedConversationId("temp", "c")).toBe("temp__c");
  });

  it("scopes isolate the same base id (distinct composed ids)", () => {
    const ids = new Set([
      scopedConversationId("app", "c"),
      scopedConversationId("user", "c"),
      scopedConversationId("temp", "c"),
    ]);
    expect(ids.size).toBe(3);
  });

  it("sessionScopePrefix returns the delete-scope prefix for a scope", () => {
    expect(scopedConversationId("temp", "x").startsWith(sessionScopePrefix("temp"))).toBe(true);
    expect(scopedConversationId("app", "x").startsWith(sessionScopePrefix("temp"))).toBe(false);
  });
});
