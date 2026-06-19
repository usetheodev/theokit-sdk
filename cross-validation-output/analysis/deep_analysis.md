# Deep Analysis — scored comparisons (target relative to reference)

Phase 3. 14 comparisons, each scored 0-5 (5 = on par with or better than reference), citing code in both projects. Scores verified against direct reads of `errors.ts`, `vitest.config.ts` exclude block, `core/src/auth/` tree, `core/src/sessions/` tree, and `internal/persistence/` tree.

| Dim | Dimension | Weight | Score | Verdict |
|---|---|---|---|---|
| 3 | Error Handling | 1.5 | **5.0** | Target leads (typed hierarchy + isRetryable + closed union) |
| 10 | API Design & DX | 1.5 | **4.5** | Target leads (façade/builder/factory + one-shot) |
| 14 | Build & Tooling | 1.0 | **4.5** | Target leads (biome/tsup-dual/native-preflight) |
| 1 | Folder Organization & Layering | 1.5 | 4.0 | On par |
| 9 | Design Patterns | 1.0 | 4.0 | On par (ref broader catalog) |
| 11 | Provider / Model Abstraction | 1.0 | 4.0 | Target broader breadth; ref has live conn |
| 12 | Observability & Telemetry | 1.0 | 4.0 | Comparable |
| 15 | Modularity & Code Organization | 1.0 | 4.0 | On par |
| 2 | Dependency Injection & Extensibility | 1.5 | 3.5 | Ref registry more open |
| 16 | Streaming & Concurrency Model | 1.0 | 3.5 | Ref has live bidirectional |
| 4 | Testing Strategy | 1.5 | 3.0 | Ref stronger (conformance/e2e/gates) |
| 17 | Session & State Persistence | 1.0 | 3.0 | Ref multi-DB; target durability prims |
| 18 | Agent Composition | 1.0 | 3.0 | Ref typed composite agents |
| 13 | Security & Auth | 1.5 | **2.5** | Ref much stronger (OAuth2/OIDC) |

## Highlights

**Target leads:** error model (`errors.ts:142` — `TheokitAgentError` + 7 typed subclasses, `isRetryable`, closed `KnownAgentRunErrorCode`), DX (`agent.ts:64` façade/builder/factory + one-shot `Agent.prompt`), and toolchain (native-bindings ABI preflight, dual ESM/CJS validated by publint/attw).

**Reference leads:** auth (`core/src/auth/` — OAuth2/OIDC exchanger+refresher+registries+`ToolAuthHandler`), sessions (`database_session_service.ts` — MikroORM multi-DB), testing (`vitest.config.ts` — cross-language conformance + e2e + 86-88% gates), composite agents (`sequential_agent.ts:41`), and an open registry pattern (`models/registry.ts:58`).

**Surprise (in target's favor):** `internal/persistence/` ships strong durability primitives — `sqlite-cas.ts`, `sqlite-wal.ts`, `atomic-write.ts`, `file-lock.ts`, `credential-pool-store.ts` — a foundation the target can build a DB-backed session store on without new plumbing.

Weighted preview (∑ weight·score / ∑ weight, weights as registered): ≈ **3.74 / 5**.
