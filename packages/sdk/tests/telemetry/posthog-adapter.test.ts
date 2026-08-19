import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The PostHog adapter is gated behind an optional peer dep (ADR D42), so under
 * the normal suite `safeRequire("posthog-node")` returns undefined and the whole
 * `register` body is skipped. The sibling adapter suites stop there and assert
 * only that it does not throw — which leaves the span filter, the capture shape
 * and the key/provider guards unexecuted.
 *
 * Stubbing `safeRequire` is what lets the real body run. The module under test
 * is unchanged; only its lookup of the optional dependency is redirected.
 */
const modules = new Map<string, unknown>();

vi.mock("../../src/internal/telemetry/safe-require.js", () => ({
  safeRequire: (name: string) => modules.get(name),
}));

interface CapturedEvent {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}

interface SpanProcessor {
  onEnd: (span: { name: string; attributes: Record<string, unknown> }) => void;
  shutdown: () => Promise<void>;
}

function makePosthogModule(captured: CapturedEvent[], shutdownSpy?: () => Promise<void>) {
  const instances: Array<{ key: string; opts?: Record<string, unknown> }> = [];
  class FakePostHog {
    constructor(key: string, opts?: Record<string, unknown>) {
      instances.push({ key, opts });
    }
    capture(event: CapturedEvent): void {
      captured.push(event);
    }
    shutdown = shutdownSpy;
  }
  return { module: { PostHog: FakePostHog }, instances };
}

function makeOtel(provider: Record<string, unknown>) {
  return { trace: { getTracerProvider: () => provider } };
}

/** Fresh module state per test — `registeredHere` is a module-level singleton. */
async function loadAdapter() {
  vi.resetModules();
  const mod = await import("../../src/internal/telemetry/adapters/posthog.js");
  return mod.posthogAdapter;
}

beforeEach(() => {
  modules.clear();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("posthog adapter — identity", () => {
  it("declares the module it detects", async () => {
    const adapter = await loadAdapter();
    expect(adapter.moduleName).toBe("posthog-node");
    expect(adapter.displayName).toBe("PostHog");
  });

  it("reports undetected when posthog-node is absent", async () => {
    const adapter = await loadAdapter();
    expect(adapter.detect()).toBe(false);
  });

  // § 4.2 — the accepted input. Without it, a `detect` hard-wired to `false`
  // would pass the rejection row above and never be noticed.
  it("reports detected when posthog-node resolves", async () => {
    modules.set("posthog-node", makePosthogModule([]).module);
    const adapter = await loadAdapter();
    expect(adapter.detect()).toBe(true);
  });
});

describe("posthog adapter — registration guards", () => {
  it("degrades silently when the optional dependency is absent", async () => {
    const adapter = await loadAdapter();
    expect(() => adapter.register()).not.toThrow();
  });

  it("does not construct a client when no API key is configured", async () => {
    const { module, instances } = makePosthogModule([]);
    modules.set("posthog-node", module);
    modules.set("@opentelemetry/api", makeOtel({ addSpanProcessor: vi.fn() }));
    vi.stubEnv("POSTHOG_API_KEY", "");
    vi.stubEnv("POSTHOG_PROJECT_API_KEY", "");

    const adapter = await loadAdapter();
    adapter.register();

    // Sending telemetry to PostHog without a key would be a silent 401 loop.
    expect(instances).toHaveLength(0);
  });

  it("falls back to POSTHOG_PROJECT_API_KEY when POSTHOG_API_KEY is absent", async () => {
    const { module, instances } = makePosthogModule([]);
    modules.set("posthog-node", module);
    modules.set("@opentelemetry/api", makeOtel({ addSpanProcessor: vi.fn() }));
    vi.stubEnv("POSTHOG_API_KEY", undefined);
    vi.stubEnv("POSTHOG_PROJECT_API_KEY", "proj-key");

    const adapter = await loadAdapter();
    adapter.register();

    expect(instances).toHaveLength(1);
    expect(instances[0]?.key).toBe("proj-key");
  });

  // Pins CURRENT behaviour, which is a trap rather than a design: the source
  // reads `POSTHOG_API_KEY ?? POSTHOG_PROJECT_API_KEY`, and `??` does not treat
  // an empty string as absent. `POSTHOG_API_KEY=` in a .env or CI config — a
  // very ordinary way to "leave it blank" — therefore masks a correctly set
  // POSTHOG_PROJECT_API_KEY, and telemetry silently stops. Changing this is a
  // product decision; the test exists so the change is deliberate and visible.
  it("lets an EMPTY POSTHOG_API_KEY mask a valid POSTHOG_PROJECT_API_KEY", async () => {
    const { module, instances } = makePosthogModule([]);
    modules.set("posthog-node", module);
    modules.set("@opentelemetry/api", makeOtel({ addSpanProcessor: vi.fn() }));
    vi.stubEnv("POSTHOG_API_KEY", "");
    vi.stubEnv("POSTHOG_PROJECT_API_KEY", "proj-key");

    const adapter = await loadAdapter();
    adapter.register();

    expect(instances).toHaveLength(0);
  });

  it("uses the default PostHog host when none is configured", async () => {
    const { module, instances } = makePosthogModule([]);
    modules.set("posthog-node", module);
    modules.set("@opentelemetry/api", makeOtel({ addSpanProcessor: vi.fn() }));
    vi.stubEnv("POSTHOG_API_KEY", "k");
    vi.stubEnv("POSTHOG_HOST", undefined);

    const adapter = await loadAdapter();
    adapter.register();

    expect(instances[0]?.opts?.host).toBe("https://us.i.posthog.com");
  });

  it("honours a configured PostHog host", async () => {
    const { module, instances } = makePosthogModule([]);
    modules.set("posthog-node", module);
    modules.set("@opentelemetry/api", makeOtel({ addSpanProcessor: vi.fn() }));
    vi.stubEnv("POSTHOG_API_KEY", "k");
    vi.stubEnv("POSTHOG_HOST", "https://eu.posthog.example");

    const adapter = await loadAdapter();
    adapter.register();

    expect(instances[0]?.opts?.host).toBe("https://eu.posthog.example");
  });

  it("skips a no-op tracer provider that cannot accept a span processor", async () => {
    const { module } = makePosthogModule([]);
    modules.set("posthog-node", module);
    modules.set("@opentelemetry/api", makeOtel({}));
    vi.stubEnv("POSTHOG_API_KEY", "k");

    const adapter = await loadAdapter();
    expect(() => adapter.register()).not.toThrow();
  });

  it("registers the span processor exactly once across repeated calls", async () => {
    const addSpanProcessor = vi.fn();
    const { module } = makePosthogModule([]);
    modules.set("posthog-node", module);
    modules.set("@opentelemetry/api", makeOtel({ addSpanProcessor }));
    vi.stubEnv("POSTHOG_API_KEY", "k");

    const adapter = await loadAdapter();
    adapter.register();
    adapter.register();

    // EC-12: a second processor would double-count every span as a PostHog event.
    expect(addSpanProcessor).toHaveBeenCalledTimes(1);
  });
});

describe("posthog adapter — span capture", () => {
  async function registerAndGetProcessor(captured: CapturedEvent[]): Promise<SpanProcessor> {
    const addSpanProcessor = vi.fn();
    const { module } = makePosthogModule(captured, async () => undefined);
    modules.set("posthog-node", module);
    modules.set("@opentelemetry/api", makeOtel({ addSpanProcessor }));
    vi.stubEnv("POSTHOG_API_KEY", "k");
    const adapter = await loadAdapter();
    adapter.register();
    return addSpanProcessor.mock.calls[0]?.[0] as SpanProcessor;
  }

  it("captures a span in the agent taxonomy", async () => {
    const captured: CapturedEvent[] = [];
    const processor = await registerAndGetProcessor(captured);

    processor.onEnd({ name: "agent.send", attributes: { "agent.id": "a-42" } });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.event).toBe("theokit.agent.send");
    expect(captured[0]?.distinctId).toBe("a-42");
  });

  it("captures llm and tool spans too", async () => {
    const captured: CapturedEvent[] = [];
    const processor = await registerAndGetProcessor(captured);

    processor.onEnd({ name: "llm.call", attributes: {} });
    processor.onEnd({ name: "tool.call", attributes: {} });

    expect(captured.map((e) => e.event)).toEqual(["theokit.llm.call", "theokit.tool.call"]);
  });

  it("ignores spans outside the agent/llm/tool taxonomy", async () => {
    const captured: CapturedEvent[] = [];
    const processor = await registerAndGetProcessor(captured);

    processor.onEnd({ name: "http.request", attributes: { "agent.id": "a-1" } });
    processor.onEnd({ name: "db.query", attributes: {} });

    // Forwarding every span would ship unrelated instrumentation to PostHog.
    expect(captured).toHaveLength(0);
  });

  it("falls back to an anonymous distinctId when the span carries no agent id", async () => {
    const captured: CapturedEvent[] = [];
    const processor = await registerAndGetProcessor(captured);

    processor.onEnd({ name: "agent.send", attributes: {} });

    expect(captured[0]?.distinctId).toBe("anonymous");
  });

  it("forwards only scalar attributes, dropping objects and arrays", async () => {
    const captured: CapturedEvent[] = [];
    const processor = await registerAndGetProcessor(captured);

    processor.onEnd({
      name: "agent.send",
      attributes: {
        "agent.id": "a-1",
        "tokens.in": 120,
        cached: true,
        // Privacy: a nested payload could carry prompt content, which this
        // adapter is explicitly not allowed to forward.
        payload: { prompt: "secret user text" },
        tags: ["a", "b"],
      },
    });

    const props = captured[0]?.properties ?? {};
    expect(props).toEqual({ "agent.id": "a-1", "tokens.in": 120, cached: true });
    expect(props).not.toHaveProperty("payload");
    expect(props).not.toHaveProperty("tags");
  });

  it("delegates shutdown to the PostHog client so buffered events flush", async () => {
    const shutdown = vi.fn(async () => undefined);
    const addSpanProcessor = vi.fn();
    const { module } = makePosthogModule([], shutdown);
    modules.set("posthog-node", module);
    modules.set("@opentelemetry/api", makeOtel({ addSpanProcessor }));
    vi.stubEnv("POSTHOG_API_KEY", "k");
    const adapter = await loadAdapter();
    adapter.register();
    const processor = addSpanProcessor.mock.calls[0]?.[0] as SpanProcessor;

    await processor.shutdown();

    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
