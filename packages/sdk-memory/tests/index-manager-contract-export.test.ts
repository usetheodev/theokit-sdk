/**
 * sdk-memory `index-manager-contract` types export smoke test (iter 47).
 *
 * Validates the iter 47 hybrid copy of the IndexManager type contract.
 * sdk-memory now ships the canonical contract types that future
 * provider impls (sqlite-vec, lance, etc.) target.
 */

import type {
  IndexStatus,
  MemoryBackend,
  OpenIndexOptions,
  SearchOptions,
} from "@theokit/sdk-memory";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("sdk-memory IndexManager contract types (iter 47)", () => {
  it("test_MemoryBackend_union_pinned", () => {
    expectTypeOf<MemoryBackend>().toEqualTypeOf<"sqlite-vec" | "lance">();
  });

  it("test_IndexStatus_type_exported", () => {
    expectTypeOf<IndexStatus>().toBeObject();
  });

  it("test_SearchOptions_type_exported", () => {
    expectTypeOf<SearchOptions>().toBeObject();
  });

  it("test_OpenIndexOptions_includes_backend_field", () => {
    expectTypeOf<OpenIndexOptions>().toMatchTypeOf<{
      backend?: MemoryBackend;
    }>();
  });

  it("test_consumer_can_use_MemoryBackend_literal", () => {
    const backend: MemoryBackend = "lance";
    expect(backend).toBe("lance");
    const backend2: MemoryBackend = "sqlite-vec";
    expect(backend2).toBe("sqlite-vec");
  });
});
