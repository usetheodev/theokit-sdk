# Edge Case Review — zod-v4-migration

Date: 2026-06-10
Tasks analyzed: 12 (T0.1, T1.1-T1.3, T2.1-T2.4, T3.1-T3.3, Final)
Edge cases found: 6 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 1)

## MUST FIX

### EC-1: `z.toJSONSchema()` output includes `$schema` and `additionalProperties: false` — differs from previous `zod-to-json-schema` output
- **Affected task:** T1.3
- **Family:** Format
- **Scenario:** Zod v4 native `z.toJSONSchema()` emits `{ "$schema": "https://json-schema.org/draft/2020-12/schema", "additionalProperties": false, ... }`. The previous `zod-to-json-schema` library did NOT emit `$schema` and emitted `additionalProperties` only when explicitly configured. The `inputSchema` is passed directly to LLM providers (`input_schema` for Anthropic, `parameters` for OpenAI).
- **Impact:** `$schema` is benign (both providers ignore it). `additionalProperties: false` is actually CORRECT for LLM tool specs (OpenAI recommends it for strict mode). However, any existing golden test or snapshot that compares JSON Schema output byte-for-byte will break.
- **Suggested fix:** In T1.3's snapshot test, update the golden fixture to include `$schema` and `additionalProperties: false`. Add a `// NOTE: Zod v4 native adds these fields; both Anthropic and OpenAI tolerate them` comment in the test.

### EC-2: Zod v4 error messages differ from v3 — tests asserting on `.message` text will break
- **Affected task:** T1.1 (PersistenceSchema), T2.3 (sdk-cache)
- **Family:** Format
- **Scenario:** Zod v4 error messages have a different format: v3 says `"Expected string, received number"`, v4 says `"Invalid input: expected string, received number"`. The plan's T1.1 acceptance criterion checks `message matching /dir is required/i` — this is custom `.refine()` text so it survives. But the sdk-cache test at `tests/cache-create.test.ts:33` asserts `toThrow(/dir is required/i)` which will pass. **However**, any test that asserts on default Zod error text (not custom `.refine()` text) will fail.
- **Impact:** Grep found zero tests asserting on default Zod error messages (e.g., "Expected string"), so the current codebase is safe. But the plan should document this as a regression risk for future tests.
- **Suggested fix:** Add to T3.2 (MIGRATION.md): "Zod v4 default error messages changed format. Tests asserting on exact Zod error text must be updated. Custom `.refine()` messages are unaffected."

## SHOULD TEST

### EC-3: `z.toJSONSchema()` with `.refine()` / `.transform()` — unrepresentable schemas
- **Affected task:** T1.3
- **Suggested test:** `test_to_json_schema_with_refine_produces_valid_schema()` — verify that `z.toJSONSchema(z.object({x: z.string()}).refine(() => true), {unrepresentable: "any"})` produces a valid JSON Schema without throwing. The `{unrepresentable: "any"}` option must be passed to avoid Zod v4 throwing on schemas that can't be fully represented in JSON Schema.

### EC-4: `pnpm.overrides` does not override peer deps declared by external consumers
- **Affected task:** T0.1
- **Suggested test:** `test_consumer_with_zod_v3_gets_peer_warning()` — after the migration, create a temporary directory that `pnpm add @theokit/sdk zod@3.25.0` and verify the peer dep warning fires. This tests the consumer experience, not the workspace.

### EC-5: `ZodIssueCode` enum values changed in v4
- **Affected task:** T1.2
- **Suggested test:** `test_zod_issue_code_custom_is_available()` — verify `z.ZodIssueCode.custom` exists (used in `persistence-schema.ts` for the restored `.superRefine()` / `.refine()`). v4 preserves `custom` but renamed several other codes (`invalid_string` → `invalid_format`, etc.). Grep shows the codebase does NOT switch on any renamed codes, but a regression test prevents future issues.

## DOCUMENT

### EC-6: `additionalProperties: false` in tool schemas is a behavioral change for consumers
- **Accepted risk:** Prior to this migration, tool JSON schemas did NOT include `additionalProperties: false`. After migration, they will (Zod v4 native default). This means LLMs will be told they cannot pass extra parameters. This is the CORRECT behavior per OpenAI/Anthropic specs and unlikely to cause issues in practice — LLMs should only pass declared parameters. However, consumers who rely on the LLM passing undeclared extra fields (extremely unlikely but possible in edge cases with custom models) will see a behavioral change. This is acceptable as a pre-1.0 minor bump change. Document in MIGRATION.md.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T0.1 | 1 | 0 | 1 (EC-4) | 0 |
| T1.1 | 1 | 1 (EC-2) | 0 | 0 |
| T1.2 | 1 | 0 | 1 (EC-5) | 0 |
| T1.3 | 2 | 1 (EC-1) | 1 (EC-3) | 0 |
| T2.1 | 0 | 0 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T2.3 | 1 | 0 | 0 | 1 (EC-6) |
| T2.4 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 0 | 0 | 0 | 0 |
| T3.3 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 2 MUST FIX items (EC-1: update golden fixtures for new `$schema` + `additionalProperties` in JSON Schema output; EC-2: document error message format change in MIGRATION.md). Both are small additions to existing tasks, not new phases.
