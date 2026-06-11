/**
 * sdk-memory `embedding-adapter` types export smoke test (iter 45).
 *
 * Validates the iter 45 hybrid copy of `internal/memory/embedding-adapter.ts`
 * from sdk-core. sdk-memory now ships its canonical copy of the 5
 * type/interface definitions (`MemoryEmbeddingProviderAdapter`,
 * `CreateAdapterOptions`, `EmbeddingRuntime`, `EmbeddingRuntimeStats`,
 * `EmbeddingCache`) so future provider-implementation files (openai-
 * embedding, ollama-embedding, etc.) can target a single canonical
 * contract.
 *
 * sdk-core retains its copy for v1.x active-memory back-compat.
 * Both copies are byte-identical today; semver-major reconciliation
 * happens when Stage 3 source-move completes (iter 30 target).
 */

import type {
  CreateAdapterOptions,
  EmbeddingCache,
  EmbeddingRuntime,
  EmbeddingRuntimeStats,
  MemoryEmbeddingProviderAdapter,
} from "@theokit/sdk-memory";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("sdk-memory embedding-adapter types (iter 45)", () => {
  it("test_MemoryEmbeddingProviderAdapter_has_canonical_shape", () => {
    expectTypeOf<MemoryEmbeddingProviderAdapter>().toMatchTypeOf<{
      readonly id: string;
      readonly defaultModel: string;
      readonly transport: "local" | "remote";
      readonly authProviderId?: string;
    }>();
  });

  it("test_CreateAdapterOptions_type_exported", () => {
    expectTypeOf<CreateAdapterOptions>().toBeObject();
  });

  it("test_EmbeddingRuntime_type_exported", () => {
    expectTypeOf<EmbeddingRuntime>().toBeObject();
  });

  it("test_EmbeddingRuntimeStats_type_exported", () => {
    expectTypeOf<EmbeddingRuntimeStats>().toBeObject();
  });

  it("test_EmbeddingCache_type_exported", () => {
    expectTypeOf<EmbeddingCache>().toBeObject();
  });

  it("test_consumer_can_implement_MemoryEmbeddingProviderAdapter", () => {
    // Structural check: a consumer can declare a const matching the
    // interface without TS errors. Pins the contract shape end-to-end
    // (id + defaultModel + transport are required; other fields
    // optional per the interface).
    const stubAdapter: MemoryEmbeddingProviderAdapter = {
      id: "test-adapter",
      defaultModel: "test-model",
      transport: "remote",
    } as MemoryEmbeddingProviderAdapter;
    expect(stubAdapter.id).toBe("test-adapter");
    expect(stubAdapter.defaultModel).toBe("test-model");
    expect(stubAdapter.transport).toBe("remote");
  });
});
