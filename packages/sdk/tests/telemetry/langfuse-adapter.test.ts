import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Langfuse adapter (ADR D42). Its `register` carries four decision points that
 * never execute under the normal suite because the optional peer-dep is absent:
 * the no-op-provider skip, the already-attached dedup (EC-12), the Langfuse-v2
 * downgrade hint, and the happy path. Redirecting `safeRequire` runs them.
 */
const modules = new Map<string, unknown>();
const diag = vi.fn();

vi.mock("../../src/internal/telemetry/safe-require.js", () => ({
  safeRequire: (name: string) => modules.get(name),
}));
vi.mock("../../src/internal/diagnostics.js", () => ({
  diag: (msg: string) => diag(msg),
}));

class FakeLangfuse {}
class LangfuseSpanProcessor {
  constructor(public readonly opts: { langfuse: unknown }) {}
}

function makeOtel(provider: Record<string, unknown>) {
  return { trace: { getTracerProvider: () => provider } };
}

async function loadAdapter() {
  vi.resetModules();
  const mod = await import("../../src/internal/telemetry/adapters/langfuse.js");
  return mod.langfuseAdapter;
}

beforeEach(() => {
  modules.clear();
  diag.mockClear();
});

describe("langfuse adapter — identity", () => {
  it("declares the module it detects", async () => {
    const adapter = await loadAdapter();
    expect(adapter.moduleName).toBe("@langfuse/node");
    expect(adapter.displayName).toBe("Langfuse");
  });

  it("reports undetected when @langfuse/node is absent", async () => {
    const adapter = await loadAdapter();
    expect(adapter.detect()).toBe(false);
  });

  it("reports detected when @langfuse/node resolves", async () => {
    modules.set("@langfuse/node", { Langfuse: FakeLangfuse });
    const adapter = await loadAdapter();
    expect(adapter.detect()).toBe(true);
  });
});

describe("langfuse adapter — registration", () => {
  it("degrades silently when the optional dependency is absent", async () => {
    const adapter = await loadAdapter();
    expect(() => adapter.register()).not.toThrow();
  });

  it("does nothing when OTel itself is not installed", async () => {
    modules.set("@langfuse/node", { Langfuse: FakeLangfuse, LangfuseSpanProcessor });

    const adapter = await loadAdapter();
    expect(() => adapter.register()).not.toThrow();
  });

  it("skips a no-op tracer provider the user never configured", async () => {
    modules.set("@langfuse/node", { Langfuse: FakeLangfuse, LangfuseSpanProcessor });
    modules.set("@opentelemetry/api", makeOtel({}));

    const adapter = await loadAdapter();
    expect(() => adapter.register()).not.toThrow();
  });

  it("attaches the Langfuse span processor to a real provider", async () => {
    const addSpanProcessor = vi.fn();
    modules.set("@langfuse/node", { Langfuse: FakeLangfuse, LangfuseSpanProcessor });
    modules.set("@opentelemetry/api", makeOtel({ addSpanProcessor }));

    const adapter = await loadAdapter();
    adapter.register();

    expect(addSpanProcessor).toHaveBeenCalledTimes(1);
    expect(addSpanProcessor.mock.calls[0]?.[0]).toBeInstanceOf(LangfuseSpanProcessor);
  });

  it("registers only once across repeated calls", async () => {
    const addSpanProcessor = vi.fn();
    modules.set("@langfuse/node", { Langfuse: FakeLangfuse, LangfuseSpanProcessor });
    modules.set("@opentelemetry/api", makeOtel({ addSpanProcessor }));

    const adapter = await loadAdapter();
    adapter.register();
    adapter.register();

    expect(addSpanProcessor).toHaveBeenCalledTimes(1);
  });

  it("does not attach a second processor when Langfuse is already wired (EC-12)", async () => {
    const addSpanProcessor = vi.fn();
    modules.set("@langfuse/node", { Langfuse: FakeLangfuse, LangfuseSpanProcessor });
    modules.set(
      "@opentelemetry/api",
      makeOtel({
        addSpanProcessor,
        getActiveSpanProcessor: () => new LangfuseSpanProcessor({ langfuse: {} }),
      }),
    );

    const adapter = await loadAdapter();
    adapter.register();

    // The user wired Langfuse themselves; a second processor would double-export
    // every span to their Langfuse project.
    expect(addSpanProcessor).not.toHaveBeenCalled();
  });

  it("still attaches when the existing processor belongs to someone else", async () => {
    // § 4.2 — the accepting direction of the dedup predicate. A check that
    // matched ANY existing processor would silently disable Langfuse for every
    // user who already exports spans elsewhere.
    class OtlpSpanProcessor {}
    const addSpanProcessor = vi.fn();
    modules.set("@langfuse/node", { Langfuse: FakeLangfuse, LangfuseSpanProcessor });
    modules.set(
      "@opentelemetry/api",
      makeOtel({ addSpanProcessor, getActiveSpanProcessor: () => new OtlpSpanProcessor() }),
    );

    const adapter = await loadAdapter();
    adapter.register();

    expect(addSpanProcessor).toHaveBeenCalledTimes(1);
  });

  it("emits an actionable hint and skips when Langfuse v2 exposes no span processor", async () => {
    const addSpanProcessor = vi.fn();
    modules.set("@langfuse/node", { Langfuse: FakeLangfuse });
    modules.set("@opentelemetry/api", makeOtel({ addSpanProcessor }));

    const adapter = await loadAdapter();
    adapter.register();

    expect(addSpanProcessor).not.toHaveBeenCalled();
    // The hint is the only thing that tells the user why their traces are
    // missing; without it the adapter is silently inert on Langfuse v2.
    expect(diag).toHaveBeenCalledTimes(1);
    expect(diag.mock.calls[0]?.[0]).toContain("LangfuseSpanProcessor");
    expect(diag.mock.calls[0]?.[0]).toContain("v3+");
  });
});
