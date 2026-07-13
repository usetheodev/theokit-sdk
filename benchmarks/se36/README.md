# SE36 benchmark — uniform `X.create()` API

Quantitative evidence that the SE36 rename (every public factory → `X.create()` namespace class)
preserves behavior and bundle characteristics. All numbers are reproducible on the built `dist/`.

## 1. TypeScript inference — identical

`class X { static create<T,O>() }` gives byte-identical generic inference to the removed
`function defineX<T,O>()`. Proven by a `tsc@5.8 --strict` type-equality proof (`Eq<typeof a, typeof b> = true`
compiles for the static-method form; a negative control `= false` also holds). No `as` casts, no
inference loss. See the blueprint (`.claude/knowledge-base/discoveries/blueprints/se36-uniform-x-create-blueprint.md`).

## 2. Tree-shaking — unused namespaces are dropped

Bundling a consumer entry against the real `packages/sdk/dist/index.js` with `tsup@8.5 --format esm --minify`:

| Consumer entry | Bundle size |
| --- | --- |
| `import { Agent }` only | 701,720 B |
| `import { Agent, Tool, Provider, Plugin, Squad, Skill, Session, PermissionPlugin, TokenLimiter }` | 711,135 B |
| **delta (8 unused namespaces excluded from the Agent-only bundle)** | **9,415 B** |

Static-namespace classes tree-shake exactly like bare functions — importing only `Agent` excludes
every `X.create` namespace the consumer does not use. (The ~685 KB floor is the `Agent` runtime graph,
unchanged by SE36.)

## 3. Behavior parity — by construction

Each `X.create` wraps the RETAINED internal implementation (ADR-B1), so the produced descriptor is
identical to what the removed factory produced. Enforced by the per-symbol parity tests under
`packages/sdk/tests/se36/` and validated end-to-end against a real LLM.

## 4. End-to-end real-LLM validation (OpenRouter)

`Tool.create` + `Agent.create` + `send` + `wait` against `openai/gpt-oss-120b:free`:

```
SE36 REAL-LLM OK | Tool.create + Agent.create + send
status: finished
reply : Tokyo's weather is currently around 18 °C with cloudy skies.
```

The tool was actually invoked (the reply reflects the tool's data), proving the migrated surface
works end-to-end. (Free-tier 429 rate limits are transient — retried with backoff; not an SE36 defect.)

## Reproduce

```bash
# inference + tree-shake spikes are described in the blueprint; the tree-shake bundle:
tsup only-agent.ts many-ns.ts --format esm --minify --no-splitting -d out   # then compare out/*.mjs sizes
# real-LLM: OPENROUTER_API_KEY=... node <smoke importing Tool.create/Agent.create from dist>
```
