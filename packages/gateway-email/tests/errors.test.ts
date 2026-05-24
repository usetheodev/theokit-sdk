/**
 * Error mapper tests (T5.1 + EC-7 pattern).
 */

import { describe, expect, it } from "vitest";

import { mapEmailError } from "../src/errors.js";

describe("mapEmailError", () => {
  it("test_map_smtp_eauth_to_auth_failed", () => {
    expect(mapEmailError({ code: "EAUTH", message: "Invalid login" }).code).toBe("auth_failed");
  });

  it("test_map_smtp_econnection_to_server_error", () => {
    expect(mapEmailError({ code: "ECONNECTION", message: "Connection refused" }).code).toBe(
      "server_error",
    );
  });

  it("test_map_smtp_550_to_invalid_request", () => {
    expect(mapEmailError({ code: "EENVELOPE", message: "550 No such user" }).code).toBe(
      "invalid_request",
    );
  });

  it("test_map_smtp_response_code_535_to_auth_failed", () => {
    expect(mapEmailError({ responseCode: 535, message: "auth fail" }).code).toBe("auth_failed");
  });

  it("test_map_smtp_response_code_421_to_rate_limit", () => {
    expect(mapEmailError({ responseCode: 421 }).code).toBe("rate_limit");
  });

  it("test_map_imap_auth_failed", () => {
    expect(mapEmailError({ name: "IMAP_AUTH_FAILED", message: "auth failed" }).code).toBe(
      "auth_failed",
    );
  });

  it("test_map_plain_error_econnrefused_to_server_error", () => {
    expect(mapEmailError(new Error("connect ECONNREFUSED 0.0.0.0:993")).code).toBe("server_error");
  });

  it("test_map_null_to_unknown", () => {
    expect(mapEmailError(null).code).toBe("unknown");
    expect(mapEmailError(undefined).code).toBe("unknown");
  });

  it("test_map_string_to_unknown", () => {
    expect(mapEmailError("oops").code).toBe("unknown");
  });

  it("test_map_etimedout_to_timeout", () => {
    expect(mapEmailError({ code: "ETIMEDOUT", message: "timeout" }).code).toBe("timeout");
  });
});
