# Edge Case Review — agentic-decorators

Date: 2026-06-10
Tasks analyzed: 5 (T1.1, T2.1, T2.2, T2.3, T2.4)
Edge cases found: 5 (MUST FIX: 1, SHOULD TEST: 3, DOCUMENT: 1)

## MUST FIX

### EC-1: `reflect-metadata` not imported at decorator call site — runtime crash
- **Affected task:** T2.1, T2.2, T2.3, T2.4 (all decorators)
- **Family:** Resource / Integration
- **Scenario:** Consumer uses `@UseSandbox()` without `import "reflect-metadata"` at the top of their file. `Reflect.defineMetadata` is `undefined` → `TypeError: Cannot read properties of undefined`. The existing `@Injectable` in `@theokit/di` works because the container imports `reflect-metadata` as a side-effect on load. But if `di-agent` decorators are used WITHOUT the container (standalone metadata storage), the polyfill may not be loaded.
- **Impact:** Runtime crash on decorator application (class load time), not at call time.
- **Suggested fix:** Each decorator file MUST `import "reflect-metadata"` at the top (side-effect import). This is idempotent — importing twice is harmless. Matches the pattern in `@theokit/di/src/decorators/injectable.ts`.

## SHOULD TEST

### EC-2: Decorator applied to a class without `experimentalDecorators` enabled
- **Affected task:** T2.1-T2.4
- **Suggested test:** `test_decorator_throws_meaningful_error_without_reflect()` — mock `Reflect.defineMetadata` as undefined, verify the decorator throws a clear error message ("reflect-metadata polyfill required") instead of opaque TypeError.

### EC-3: @Hitl applied to a non-async method
- **Affected task:** T2.3
- **Suggested test:** `test_hitl_on_sync_method_stores_metadata()` — verify `@Hitl` works on a synchronous method (metadata stored regardless of async). The consumer's method signature is their responsibility; the decorator shouldn't enforce async at metadata-storage time.

### EC-4: @SubAgent with empty `instructions` string
- **Affected task:** T2.2
- **Suggested test:** `test_sub_agent_empty_instructions_stores_as_is()` — verify empty string is stored without error. Validation happens at `defineSubAgent()` call time, not at decorator time. Metadata is a declaration, not execution.

## DOCUMENT

### EC-5: Decorators store metadata but do NOT auto-wire into the DI container
- **Accepted risk:** The plan explicitly states decorators store metadata + provide reader helpers, but the DI container does NOT auto-resolve decorated properties/methods. Container integration requires a plugin system (future plan). This means `@UseSandbox()` stores config but the consumer must call `readSandboxMetadata(MyClass)` and manually create the `LocalSandbox`. This is acceptable because: (a) the reader helper pattern matches `@Qualifier` and `@Primary` which are also metadata-only today, (b) container plugins are a separate scope, and (c) the metadata IS the decorator contract — auto-wiring is DX sugar on top.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 2 | 1 (EC-1) | 1 (EC-2) | 0 |
| T2.2 | 1 | 0 | 1 (EC-4) | 0 |
| T2.3 | 1 | 0 | 1 (EC-3) | 0 |
| T2.4 | 1 | 0 | 0 | 1 (EC-5) |

**Verdict:** PLAN NEEDS ADJUSTMENT — 1 MUST FIX (EC-1: each decorator file must `import "reflect-metadata"` as side-effect). Minor — one line per file.
