/**
 * ObservabilityContext — public type for structured observability
 * across agent runtime, memory, and tool dispatch (T10.2, ADR D449).
 *
 * Consumers use this type to thread tracing/logging context through
 * custom tools and plugins.
 *
 * @public
 */

export interface ObservabilityContext {
  /** Current trace ID (W3C Trace Context format). */
  traceId: string;
  /** Current span ID. */
  spanId: string;
  /** Parent span ID (undefined for root spans). */
  parentSpanId?: string;
  /** Structured log emitter. */
  log: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    attrs?: Record<string, unknown>,
  ) => void;
  /** Record a counter metric. */
  counter: (name: string, value?: number, attrs?: Record<string, unknown>) => void;
  /** Record a histogram metric. */
  histogram: (name: string, value: number, attrs?: Record<string, unknown>) => void;
}
