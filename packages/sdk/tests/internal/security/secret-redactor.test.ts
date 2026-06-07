/**
 * T9.1 / AF#16 — SecretRedactor interface RED test.
 *
 * Plan: arch-review-fixes-2026-06-06 § Phase 9 / T9.1
 *
 * Asserts (a) the new `SecretRedactor` interface exists and exports correctly
 * from `internal/security/secret-redactor.ts`; (b) the canonical
 * `redactSecrets` function is structurally compatible with it (TypeScript
 * structural typing — no class wrapper required); (c) consumers can hold a
 * `SecretRedactor` reference and call `.redact(value)` to get a string back.
 *
 * The interface is the Zone-of-Pain mitigation per D437: introduces ONE
 * stable abstraction so other modules can DEPEND ON the interface rather
 * than the concrete `redactSecrets` function, slightly lowering A (instability
 * remains intentional per ADRs D68-D73 — security primitives must be
 * concrete and stable).
 */
import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../../src/internal/security/index.js";
import type { SecretRedactor } from "../../../src/internal/security/secret-redactor.js";

describe("SecretRedactor — interface + structural compatibility (T9.1 / AF#16)", () => {
  it("interface accepts the canonical redactSecrets as a structural implementer", () => {
    // Structural typing: redactSecrets has signature
    // (text: unknown, opts?: { codeFile?: boolean }) => string
    // The interface expects (value: unknown) => string. The function is
    // structurally assignable because the second parameter is optional.
    const redactor: SecretRedactor = { redact: redactSecrets };
    expect(typeof redactor.redact).toBe("function");
  });

  it("redactor.redact masks a recognized OpenAI key (D71 two-bucket: long preserves prefix+suffix)", () => {
    const redactor: SecretRedactor = { redact: redactSecrets };
    const original = "token: sk-proj-AAAAAAAAAAAAAAAAAAAA";
    const result = redactor.redact(original);
    // Full literal must not survive
    expect(result).not.toContain("sk-proj-AAAAAAAAAAAAAAAAAAAA");
    // D71: long bucket masks middle with "..." preserving prefix + suffix
    expect(result).toContain("...");
  });

  it("redactor.redact returns empty string for null-ish input", () => {
    const redactor: SecretRedactor = { redact: redactSecrets };
    expect(redactor.redact(null)).toBe("");
    expect(redactor.redact(undefined)).toBe("");
  });

  it("interface is type-only — no runtime symbol leaks", async () => {
    // Importing the interface module should not introduce any runtime
    // export beyond the `SecretRedactor` type. This protects the bundle
    // size guarantee in ADR D437.
    const mod = await import("../../../src/internal/security/secret-redactor.js");
    // The module's runtime exports should be empty (TypeScript erases interfaces).
    const runtimeKeys = Object.keys(mod);
    expect(runtimeKeys).toEqual([]);
  });
});
