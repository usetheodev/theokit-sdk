/**
 * Error mapper tests (T4.1 + EC-7).
 */

import { describe, expect, it } from "vitest";

import { mapTeamsError } from "../src/errors.js";

describe("mapTeamsError", () => {
  it("test_map_401_to_auth_failed", () => {
    expect(mapTeamsError({ status: 401, message: "no token" }).code).toBe("auth_failed");
  });

  it("test_map_403_to_auth_failed", () => {
    expect(mapTeamsError({ status: 403, message: "forbidden" }).code).toBe("auth_failed");
  });

  it("test_map_429_to_rate_limit", () => {
    expect(mapTeamsError({ status: 429 }).code).toBe("rate_limit");
  });

  it("test_map_400_to_invalid_request", () => {
    expect(mapTeamsError({ status: 400 }).code).toBe("invalid_request");
  });

  it("test_map_5xx_to_server_error", () => {
    expect(mapTeamsError({ status: 503 }).code).toBe("server_error");
  });

  it("test_map_unknown_to_unknown", () => {
    expect(mapTeamsError({ status: 418 }).code).toBe("unknown");
  });

  it("test_map_handles_string_input", () => {
    expect(mapTeamsError("oops").code).toBe("unknown");
  });

  it("test_map_handles_null", () => {
    expect(mapTeamsError(null).code).toBe("unknown");
    expect(mapTeamsError(undefined).code).toBe("unknown");
  });

  it("test_map_plain_error_without_status (EC-7) — ECONNREFUSED → server_error", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:3978");
    const m = mapTeamsError(err);
    expect(m.code).toBe("server_error");
    expect(m.message).toContain("ECONNREFUSED");
  });

  it("test_map_plain_error_without_status_unknown_message → unknown", () => {
    expect(mapTeamsError(new Error("random failure")).code).toBe("unknown");
  });

  it("test_map_handles_statusCode_field (EC-7) — alternative name", () => {
    expect(mapTeamsError({ statusCode: 401 }).code).toBe("auth_failed");
    expect(mapTeamsError({ statusCode: 429 }).code).toBe("rate_limit");
  });
});
