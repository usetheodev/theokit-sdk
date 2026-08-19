import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sentry adapter (ADR D42). Under the normal suite the optional peer-dep is
 * absent, so `register` returns at the first guard and the event processor —
 * the only thing the adapter actually contributes — never runs. Redirecting
 * `safeRequire` lets the real body execute against a fake Sentry.
 */
const modules = new Map<string, unknown>();

vi.mock("../../src/internal/telemetry/safe-require.js", () => ({
  safeRequire: (name: string) => modules.get(name),
}));

type EventProcessor = (event: unknown) => unknown;

function makeSentry(): { module: Record<string, unknown>; processors: EventProcessor[] } {
  const processors: EventProcessor[] = [];
  return {
    module: { addEventProcessor: (fn: EventProcessor) => processors.push(fn) },
    processors,
  };
}

function makeOtelWithSpan(traceId: string, spanId: string) {
  return {
    trace: {
      getActiveSpan: () => ({ spanContext: () => ({ traceId, spanId }) }),
    },
  };
}

async function loadAdapter() {
  vi.resetModules();
  const mod = await import("../../src/internal/telemetry/adapters/sentry.js");
  return mod.sentryAdapter;
}

beforeEach(() => {
  modules.clear();
});

describe("sentry adapter — identity", () => {
  it("declares the module it detects", async () => {
    const adapter = await loadAdapter();
    expect(adapter.moduleName).toBe("@sentry/node");
    expect(adapter.displayName).toBe("Sentry");
  });

  it("reports undetected when @sentry/node is absent", async () => {
    const adapter = await loadAdapter();
    expect(adapter.detect()).toBe(false);
  });

  it("reports detected when @sentry/node resolves", async () => {
    modules.set("@sentry/node", makeSentry().module);
    const adapter = await loadAdapter();
    expect(adapter.detect()).toBe(true);
  });
});

describe("sentry adapter — registration guards", () => {
  it("degrades silently when the optional dependency is absent", async () => {
    const adapter = await loadAdapter();
    expect(() => adapter.register()).not.toThrow();
  });

  it("skips a Sentry build that has not exposed addEventProcessor yet", async () => {
    // Some Sentry versions only expose it after Sentry.init(); calling it
    // regardless would throw during agent startup.
    modules.set("@sentry/node", { getActiveSpan: () => undefined });

    const adapter = await loadAdapter();
    expect(() => adapter.register()).not.toThrow();
  });

  it("attaches the event processor exactly once across repeated calls", async () => {
    const sentry = makeSentry();
    modules.set("@sentry/node", sentry.module);

    const adapter = await loadAdapter();
    adapter.register();
    adapter.register();

    // EC-12: a second processor would enrich — and re-enrich — every event.
    expect(sentry.processors).toHaveLength(1);
  });
});

describe("sentry adapter — trace enrichment", () => {
  it("stamps the active OTel trace context onto the event", async () => {
    const sentry = makeSentry();
    modules.set("@sentry/node", sentry.module);
    modules.set("@opentelemetry/api", makeOtelWithSpan("trace-abc", "span-123"));
    const adapter = await loadAdapter();
    adapter.register();

    const event = sentry.processors[0]?.({ message: "boom" }) as {
      contexts?: { trace?: Record<string, string> };
    };

    // Correlating a Sentry error with its trace IS the adapter's whole purpose.
    expect(event.contexts?.trace).toEqual({ trace_id: "trace-abc", span_id: "span-123" });
  });

  it("preserves contexts the event already carried", async () => {
    const sentry = makeSentry();
    modules.set("@sentry/node", sentry.module);
    modules.set("@opentelemetry/api", makeOtelWithSpan("t", "s"));
    const adapter = await loadAdapter();
    adapter.register();

    const event = sentry.processors[0]?.({ contexts: { runtime: { name: "node" } } }) as {
      contexts: Record<string, unknown>;
    };

    expect(event.contexts.runtime).toEqual({ name: "node" });
    expect(event.contexts.trace).toBeDefined();
  });

  it("returns the event untouched when OTel is not installed", async () => {
    const sentry = makeSentry();
    modules.set("@sentry/node", sentry.module);
    const adapter = await loadAdapter();
    adapter.register();

    const original = { message: "boom" };
    const event = sentry.processors[0]?.(original);

    expect(event).toBe(original);
    expect(event).not.toHaveProperty("contexts");
  });

  it("returns the event untouched when no span is active", async () => {
    const sentry = makeSentry();
    modules.set("@sentry/node", sentry.module);
    modules.set("@opentelemetry/api", { trace: { getActiveSpan: () => undefined } });
    const adapter = await loadAdapter();
    adapter.register();

    const original = { message: "boom" };
    const event = sentry.processors[0]?.(original);

    // An event outside any span has no trace to correlate; inventing one would
    // point the user at an unrelated trace.
    expect(event).toBe(original);
  });

  it("passes a non-object event through without throwing", async () => {
    const sentry = makeSentry();
    modules.set("@sentry/node", sentry.module);
    modules.set("@opentelemetry/api", makeOtelWithSpan("t", "s"));
    const adapter = await loadAdapter();
    adapter.register();

    expect(() => sentry.processors[0]?.(null)).not.toThrow();
    expect(sentry.processors[0]?.(null)).toBeNull();
  });
});
