# D24 — `defineTool` schema source: Zod with feature-detected JSON Schema conversion

**Status:** Decided
**Date:** 2026-05-17

## Decision

`defineTool<T extends ZodType>(spec)` is a generic helper that accepts a Zod schema as `inputSchema` and produces a `CustomTool`. It performs three jobs:

1. **JSON Schema conversion** for the LLM-facing `inputSchema` field: feature-detect `z.toJSONSchema` (Zod 4 native, since 3.24+) and fall back to the `zod-to-json-schema` dependency when only Zod 3 is installed.
2. **Runtime parse** inside the wrapped handler: `spec.inputSchema.parse(input)` runs before the user handler. Parse failure throws `ZodError`, which the existing tool-dispatch catches and turns into `tool_result(isError)` with the Zod error message.
3. **Type inference**: handler receives `z.infer<T>` instead of `Record<string, unknown>` — no `as` casts, full IDE autocomplete.

Zod stays a **peer dependency** (already declared as `^3.25 || ^4` in `packages/sdk/CLAUDE.md`'s toolchain table). `defineTool` is **opt-in**: consumers who skip Zod keep using the raw `CustomTool` shape via `AgentOptions.tools`.

## Rationale

Type-safe tool definitions are the highest-ROI DX win because handlers see runtime input that the LLM controls. Today, `examples/telegram-pro/src/ad-hoc-tools.ts` casts every handler arg to a session-specific interface (`as RollInput`, `as Base64Input`, etc) with zero runtime check — invalid input becomes silent `NaN` or `undefined`.

Zod was the obvious choice because:
- It is already a declared peer dep — no new toolchain decision.
- TypeScript ecosystem standard (Anthropic SDK, Vercel AI SDK, OpenAI SDK all use it).
- Built-in JSON Schema conversion in Zod 4 (no extra dep cost for new consumers).
- Handler type inference falls out of `z.infer<T>` for free.

Alternatives considered:
- **Raw JSON Schema with `Ajv` runtime validation**: rejected — `Ajv` adds 100KB+ and consumers writing JSON Schema by hand lose type inference.
- **TypeBox**: rejected — less idiomatic in TS ecosystem, splits the audience.
- **Zod-only with hard dep**: rejected — consumers without Zod would be forced to install it just to use `Agent.create({ tools: [...] })`. Peer-dep keeps the surface optional.

Feature-detect over fixed Zod version:
- Supporting both Zod 3 and 4 avoids forcing consumers to upgrade. The cost is ~5KB extra on the Zod 3 path (`zod-to-json-schema` package, peer-installed when needed).
- Detection: `typeof z.toJSONSchema === "function"` — single boolean check at module load.

## Consequences

- Consumers who don't use Zod see no change. `AgentOptions.tools` with raw `CustomTool` literals continues to work.
- Consumers who adopt `defineTool` gain: type-inferred handlers, runtime input validation, and zero JSON Schema authoring.
- Bundle size for non-Zod consumers: zero (peer dep, not bundled). For Zod consumers: zero new code (they already pay for Zod).
- Zod-to-JSON-Schema fidelity is not 100%: complex `z.refine`/`z.transform` may produce loose schemas. Documented; consumers needing precise schemas pass raw `CustomTool`.
- Handler signature changes between `CustomTool` and `defineTool`: former receives `Record<string, unknown>`, latter receives `z.infer<T>`. This is the point — type-safety is the differentiator.
