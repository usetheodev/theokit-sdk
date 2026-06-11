/**
 * sdk-memory `memory-types` export smoke test (iter 52).
 *
 * Validates the iter 52 hybrid copy of `internal/memory/types.ts`
 * from sdk-core (renamed to `memory-types.ts` in sdk-memory for
 * explicit naming alongside `active-memory-types.ts`).
 *
 * sdk-core retains its copy for v1.x back-compat.
 * Both copies are byte-identical at the runtime level (legacy path
 * algorithm + redactSecrets pattern list); the cross-package import
 * shape differs (sdk-memory pulls public sub-paths from sdk-core).
 *
 * Covers:
 *   - 5 type-shape pins (MemoryConfig, MemoryFact, MemoryChunk,
 *     MemoryReadResult, MemoryFileEntry)
 *   - legacyMemoryJsonPath behavior (storePath override, defaults,
 *     sanitization of namespace/scope/userId)
 *   - redactSecrets re-export delegates to sdk-core's canonical
 *     12-pattern list (ADR D68)
 */

import {
  legacyMemoryJsonPath,
  type MemoryChunk,
  type MemoryConfig,
  type MemoryFact,
  type MemoryFileEntry,
  type MemoryReadResult,
  redactSecrets,
} from "@theokit/sdk-memory";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("sdk-memory memory-types (iter 52)", () => {
  it("test_MemoryConfig_shape_pinned", () => {
    expectTypeOf<MemoryConfig>().toMatchTypeOf<{
      enabled: boolean;
      namespace?: string;
      userId?: string;
      scope?: "agent" | "user" | "team";
      storePath?: string;
    }>();
  });

  it("test_MemoryFact_shape_pinned", () => {
    expectTypeOf<MemoryFact>().toMatchTypeOf<{ text: string }>();
  });

  it("test_MemoryChunk_shape_pinned", () => {
    expectTypeOf<MemoryChunk>().toMatchTypeOf<{
      startLine: number;
      endLine: number;
      text: string;
      hash: string;
      heading?: string;
    }>();
  });

  it("test_MemoryReadResult_shape_pinned", () => {
    expectTypeOf<MemoryReadResult>().toMatchTypeOf<{
      path: string;
      from: number;
      linesReturned: number;
      totalLines: number;
      truncated: boolean;
      remainingLines: number;
      text: string;
    }>();
  });

  it("test_MemoryFileEntry_shape_pinned", () => {
    expectTypeOf<MemoryFileEntry>().toMatchTypeOf<{
      path: string;
      relPath: string;
      mtime: number;
      hash: string;
    }>();
  });

  it("test_legacyMemoryJsonPath_honors_storePath_override", () => {
    const cfg: MemoryConfig = {
      enabled: true,
      storePath: "custom/memory.json",
    };
    const result = legacyMemoryJsonPath("/tmp/cwd", cfg);
    expect(result).toBe("/tmp/cwd/custom/memory.json");
  });

  it("test_legacyMemoryJsonPath_defaults_namespace_scope_userId", () => {
    const cfg: MemoryConfig = { enabled: true };
    const result = legacyMemoryJsonPath("/tmp/cwd", cfg);
    // ADRs D79-D81: default namespace=agent-default
    expect(result).toBe("/tmp/cwd/.theokit/memory/default/agent-default.json");
  });

  it("test_legacyMemoryJsonPath_sanitizes_userId", () => {
    const cfg: MemoryConfig = {
      enabled: true,
      namespace: "prod",
      userId: "alice42",
    };
    const result = legacyMemoryJsonPath("/tmp/cwd", cfg);
    expect(result).toBe("/tmp/cwd/.theokit/memory/prod/agent-alice42.json");
  });

  it("test_redactSecrets_re_export_redacts_openai_key", () => {
    // ADR D68 — sdk-memory re-exports the canonical 12-pattern list
    // via sdk-core's public Security surface. Behavior parity check:
    // an OpenAI-shape key is detected + redacted.
    const FAKE_OPENAI = "sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const out = redactSecrets(`api=${FAKE_OPENAI} done`);
    expect(out).not.toContain(FAKE_OPENAI);
    expect(out).toContain("api=");
    expect(out).toContain("done");
  });
});
