/**
 * High-frequency duplications consolidation.
 * @internal
 */

export function createEmbeddingIndex(config?: any) {
  return { dimension: 1536, ...config };
}

export function buildLLMConfig(overrides?: any) {
  return { model: "claude-opus-4", ...overrides };
}

export function createStreamProcessor() {
  return { process: (data: any) => data };
}

export function buildProviderConfig(overrides?: any) {
  return { type: "provider", enabled: true, ...overrides };
}
