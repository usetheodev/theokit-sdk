/**
 * Tests for mapSlackError → canonical SendResult mapping (ADR D273).
 */

import { describe, expect, it } from "vitest";
import { mapSlackError } from "../src/errors.js";

describe("mapSlackError", () => {
  it("maps rate_limited with retry_after", () => {
    const r = mapSlackError({ data: { error: "rate_limited", retry_after: 30 } });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("rate_limit");
    expect(r.error?.message).toContain("30");
  });

  it("maps channel_not_found", () => {
    const r = mapSlackError({ data: { error: "channel_not_found" } });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("channel_not_found");
  });

  it("maps not_in_channel + missing_scope to no_permission with needed/scope", () => {
    const r1 = mapSlackError({ data: { error: "not_in_channel" } });
    expect(r1.error?.code).toBe("no_permission");
    const r2 = mapSlackError({ data: { error: "missing_scope", needed: "chat:write" } });
    expect(r2.error?.code).toBe("no_permission");
    expect(r2.error?.message).toBe("chat:write");
  });

  it("maps invalid_auth + token_revoked to auth_error", () => {
    const r1 = mapSlackError({ data: { error: "invalid_auth" } });
    expect(r1.error?.code).toBe("auth_error");
    const r2 = mapSlackError({ data: { error: "token_revoked" } });
    expect(r2.error?.code).toBe("auth_error");
  });

  it("maps msg_too_long + message_limit_exceeded to message_too_long", () => {
    const r = mapSlackError({ data: { error: "msg_too_long" } });
    expect(r.error?.code).toBe("message_too_long");
  });

  it("falls through unknown Slack errors to platform_error", () => {
    const r = mapSlackError({ data: { error: "some_new_code" }, message: "weird" });
    expect(r.error?.code).toBe("platform_error");
    expect(r.error?.message).toContain("some_new_code");
  });

  it("handles non-Slack error objects gracefully", () => {
    const r = mapSlackError(new Error("random"));
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("platform_error");
  });
});
