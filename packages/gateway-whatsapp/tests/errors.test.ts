/**
 * Error mapper tests (T4.1).
 */

import { describe, expect, it } from "vitest";

import { mapWhatsAppCloudError, mapWhatsAppWebError } from "../src/errors.js";

describe("mapWhatsAppCloudError", () => {
  it("test_map_cloud_error_190_to_auth_failed", () => {
    const e = mapWhatsAppCloudError(401, { error: { code: 190, message: "expired" } });
    expect(e.code).toBe("auth_failed");
  });

  it("test_map_cloud_error_130_to_rate_limit", () => {
    const e = mapWhatsAppCloudError(429, { error: { code: 130, message: "throttle" } });
    expect(e.code).toBe("rate_limit");
  });

  it("test_map_cloud_error_4xx_to_invalid_request", () => {
    const e = mapWhatsAppCloudError(400, { error: { code: 100, message: "bad" } });
    expect(e.code).toBe("invalid_request");
  });

  it("maps 5xx to server_error", () => {
    const e = mapWhatsAppCloudError(503, { error: { message: "down" } });
    expect(e.code).toBe("server_error");
  });

  it("falls back to unknown", () => {
    const e = mapWhatsAppCloudError(418, { teapot: true });
    expect(e.code).toBe("unknown");
  });
});

describe("mapWhatsAppWebError", () => {
  it("test_map_web_error_protocol_to_server_error", () => {
    expect(mapWhatsAppWebError("PROTOCOL_ERROR").code).toBe("server_error");
  });

  it("test_map_web_error_auth_to_auth_failed", () => {
    expect(mapWhatsAppWebError("AUTHENTICATION_FAILURE").code).toBe("auth_failed");
  });

  it("maps RATE strings to rate_limit", () => {
    expect(mapWhatsAppWebError("RATE_LIMIT_HIT").code).toBe("rate_limit");
  });

  it("maps TIMEOUT to timeout", () => {
    expect(mapWhatsAppWebError("REQUEST TIMEOUT").code).toBe("timeout");
  });

  it("falls back to unknown for unrecognized", () => {
    expect(mapWhatsAppWebError("random thing").code).toBe("unknown");
  });

  it("handles undefined gracefully", () => {
    expect(mapWhatsAppWebError(undefined).code).toBe("unknown");
  });
});
