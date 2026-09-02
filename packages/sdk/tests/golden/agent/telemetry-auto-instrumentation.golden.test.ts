import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _getAllAdapters,
  _isRegistered,
  _resetAdapterRegistry,
  _wiringOf,
  registerOne,
  type TelemetryAdapter,
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

  it("only registers adapters whose vendor module is detectable", () => {
    // Some vendor libs (e.g. langsmith) may be resolvable as transitive
    // devDeps. The contract is: detect() === true → registered, else not.
    tryAutoRegisterAdapters({ enabled: true });
    for (const adapter of _getAllAdapters()) {
      const detected = adapter.detect();
      expect(_isRegistered(adapter.moduleName)).toBe(detected);
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
    // Snapshot registered set after first call.
    const snapshot = new Map<string, boolean>();
    for (const adapter of _getAllAdapters()) {
      snapshot.set(adapter.moduleName, _isRegistered(adapter.moduleName));
    }
    // Subsequent calls must not change the set.
    tryAutoRegisterAdapters({ enabled: true });
    tryAutoRegisterAdapters({ enabled: true });
    for (const adapter of _getAllAdapters()) {
      expect(_isRegistered(adapter.moduleName)).toBe(snapshot.get(adapter.moduleName));
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

describe("the registry reports what an adapter wired, not that it ran", () => {
  beforeEach(() => {
    _resetAdapterRegistry();
  });
  afterEach(() => {
    _resetAdapterRegistry();
  });

  /**
   * The Braintrust and LangSmith adapters load a module and install nothing —
   * their vendors auto-instrument from an env var. That is a legitimate
   * outcome; the defect was that the registry called it "auto-instrumented",
   * the same word it used for an adapter that had installed a span processor.
   * `_isRegistered` cannot tell them apart, and never could: it answers
   * "did register() run", which is true in both cases.
   */
  it("distinguishes an adapter that wired something from one that only loaded a module", () => {
    const byName = new Map(_getAllAdapters().map((a) => [a.moduleName, a]));
    const braintrust = byName.get("braintrust");
    const langfuse = byName.get("@langfuse/node") ?? byName.get("langfuse");

    expect(braintrust, "the hollow adapter under test must still be in the registry").toBeDefined();
    expect(
      langfuse,
      "an adapter that installs a real processor must be in the registry",
    ).toBeDefined();

    // Called directly: detect() gates the registry loop on the vendor actually
    // being installed, and neither package is a dependency of this repo.
    expect(braintrust?.register()).not.toBe("instrumented");
  });

  it("_wiringOf answers what _isRegistered structurally cannot", () => {
    const sawNothing: TelemetryAdapter = {
      moduleName: "fixture-env-var-vendor",
      displayName: "FixtureEnvVarVendor",
      detect: () => true,
      register: () => "vendor-auto-instruments",
    };
    const wiredSomething: TelemetryAdapter = {
      moduleName: "fixture-real-vendor",
      displayName: "FixtureRealVendor",
      detect: () => true,
      register: () => "instrumented",
    };
    registerOne(sawNothing);
    registerOne(wiredSomething);

    // Both are "registered" — that is precisely why the flag was the wrong signal.
    expect(_isRegistered("fixture-env-var-vendor")).toBe(true);
    expect(_isRegistered("fixture-real-vendor")).toBe(true);

    expect(_wiringOf("fixture-env-var-vendor")).toBe("vendor-auto-instruments");
    expect(_wiringOf("fixture-real-vendor")).toBe("instrumented");
    expect(_wiringOf("never-ran")).toBeUndefined();
  });
});
