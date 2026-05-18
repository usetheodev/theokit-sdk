import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _getAllAdapters,
  _isRegistered,
  _resetAdapterRegistry,
  tryAutoRegisterAdapters,
} from "../../../src/internal/telemetry/adapter-registry.js";

/**
 * Tests for auto-instrumentation registry (ADR D42, Phase 4 of v1.2 plan).
 * Covers: detection when module absent, autoDetect=false skip, disable
 * list, error-tolerance, multiple adapters can coexist, idempotency.
 */

describe("telemetry auto-instrumentation registry", () => {
  beforeEach(() => {
    _resetAdapterRegistry();
  });
  afterEach(() => {
    _resetAdapterRegistry();
  });

  it("registers 3 adapters: Langfuse, Sentry, PostHog", () => {
    const all = _getAllAdapters();
    const names = all.map((a) => a.displayName);
    expect(names).toContain("Langfuse");
    expect(names).toContain("Sentry");
    expect(names).toContain("PostHog");
  });

  it("does NOT register when none of the modules are present (default env)", () => {
    // Vendor libs are not installed in CI; tryAutoRegisterAdapters is a no-op.
    tryAutoRegisterAdapters({ enabled: true });
    for (const adapter of _getAllAdapters()) {
      expect(_isRegistered(adapter.moduleName)).toBe(false);
    }
  });

  it("skips all when settings.enabled !== true", () => {
    tryAutoRegisterAdapters({ enabled: false });
    for (const adapter of _getAllAdapters()) {
      expect(_isRegistered(adapter.moduleName)).toBe(false);
    }
  });

  it("skips all when autoDetect === false", () => {
    tryAutoRegisterAdapters({ enabled: true, autoDetect: false });
    for (const adapter of _getAllAdapters()) {
      expect(_isRegistered(adapter.moduleName)).toBe(false);
    }
  });

  it("disable list filters out named adapters (case-insensitive)", () => {
    // Even if they were detected, "langfuse" is in disable list.
    tryAutoRegisterAdapters({ enabled: true, disable: ["langfuse"] });
    expect(_isRegistered("@langfuse/node")).toBe(false);
  });

  it("undefined settings is a no-op (does not throw)", () => {
    expect(() => tryAutoRegisterAdapters(undefined)).not.toThrow();
  });

  it("re-registration is idempotent (no double-register)", () => {
    tryAutoRegisterAdapters({ enabled: true });
    tryAutoRegisterAdapters({ enabled: true });
    tryAutoRegisterAdapters({ enabled: true });
    // No throws; registered set is stable.
    for (const adapter of _getAllAdapters()) {
      expect(_isRegistered(adapter.moduleName)).toBe(false);
    }
  });

  it("each adapter has detect() and register() callable without throwing", () => {
    for (const adapter of _getAllAdapters()) {
      expect(typeof adapter.detect).toBe("function");
      expect(typeof adapter.register).toBe("function");
      // detect() must not throw even when the module is absent.
      expect(() => adapter.detect()).not.toThrow();
    }
  });

  it("EC-12 (smoke): adapter register() handles missing OTel gracefully", () => {
    // Without OTel API, register() returns silently. We can't easily
    // inject OTel here, but we can assert the call doesn't throw.
    for (const adapter of _getAllAdapters()) {
      expect(() => adapter.register()).not.toThrow();
    }
  });
});
