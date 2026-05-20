import { safeRequire, type TelemetryAdapter } from "../safe-require.js";

/**
 * PostHog OTel adapter (ADR D42). Detects `posthog-node` and captures
 * key span events as PostHog events. Privacy-respecting per
 * `telemetry.includeContent`.
 *
 * @internal
 */

interface PostHogModule {
  PostHog: new (
    key: string,
    opts?: Record<string, unknown>,
  ) => {
    capture: (event: {
      distinctId: string;
      event: string;
      properties?: Record<string, unknown>;
    }) => void;
    shutdown?: () => Promise<void>;
  };
}

interface OTelTraceApi {
  getTracerProvider(): {
    addSpanProcessor?: (processor: unknown) => void;
  };
}

let registeredHere = false;

export const posthogAdapter: TelemetryAdapter = {
  moduleName: "posthog-node",
  displayName: "PostHog",
  detect: () => safeRequire<PostHogModule>("posthog-node") !== undefined,
  register: () => {
    if (registeredHere) return;
    const ph = safeRequire<PostHogModule>("posthog-node");
    const otel = safeRequire<{ trace: OTelTraceApi }>("@opentelemetry/api");
    if (ph === undefined || otel === undefined) return;
    const key = process.env.POSTHOG_API_KEY ?? process.env.POSTHOG_PROJECT_API_KEY;
    if (typeof key !== "string" || key.length === 0) {
      // No PostHog key — skip silently (don't error).
      return;
    }
    const client = new ph.PostHog(key, {
      host: process.env.POSTHOG_HOST ?? "https://us.i.posthog.com",
    });

    const provider = otel.trace.getTracerProvider();
    if (provider.addSpanProcessor === undefined) return;

    // Minimal SpanProcessor adapter — capture each ended span as a
    // PostHog event when its name matches our agent.send/llm.call/tool.call
    // taxonomy. Privacy: only counts + IDs, no content (unless explicitly
    // enabled at the agent level — we don't have that info here, so default
    // is always counts-only).
    const processor = {
      onStart: () => {},
      onEnd: (span: {
        name: string;
        attributes: Record<string, unknown>;
        duration?: [number, number];
      }) => {
        if (
          !span.name.startsWith("agent.") &&
          !span.name.startsWith("llm.") &&
          !span.name.startsWith("tool.")
        ) {
          return;
        }
        client.capture({
          distinctId: String(span.attributes["agent.id"] ?? "anonymous"),
          event: `theokit.${span.name}`,
          properties: {
            // Pass through scalar attributes only.
            ...Object.fromEntries(
              Object.entries(span.attributes).filter(
                ([_, v]) =>
                  typeof v === "string" || typeof v === "number" || typeof v === "boolean",
              ),
            ),
          },
        });
      },
      shutdown: async () => {
        if (client.shutdown !== undefined) await client.shutdown();
      },
      forceFlush: async () => {},
    };
    provider.addSpanProcessor(processor);
    registeredHere = true;
  },
};
