---
"@theokit/di": minor
---

Initial scaffold of `@theokit/di` — lightweight TypeScript dependency injection container for the theokit ecosystem.

Foundation for `@theokit/orm` (P2) and `@theokit/http-decorators` (P3). NestJS-compatible API with `@Injectable`, `@Inject`, `@Module`, `providers: []`, plus three lifecycle scopes (`SINGLETON`, `TRANSIENT`, `REQUEST` via `AsyncLocalStorage`).

Agent-aware integration ships as a companion package `@theokit/di-agent` with `@InjectAgent()` decorator + REQUEST-scoped `Agent.create()` factory, so every HTTP request gets an isolated Agent instance automatically.

Polyglot story (Python equivalent) deferred to P2 (schema export to JSON Schema + SQL migrations) and P3 (OpenAPI 3.x emit from `@Controller` decorators), NOT in `@theokit/di` itself — DI containers are intrinsically language-specific runtime constructs. See ADR D11 of the implementation plan.
