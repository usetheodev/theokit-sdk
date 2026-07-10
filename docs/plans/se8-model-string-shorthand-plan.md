# SE8 — Model string shorthand — Plan

**Milestone:** SE8 (SDK Evolution). DX win from the reference comparison: every peer accepts a bare
string model id; we require `{ id }`.

## Goal

Accept `model: "openai/gpt-4o-mini"` (bare string) wherever a model is selected — `AgentOptions.model`
and `SendOptions.model` — normalized to `{ id: string }` at ONE seam, so all downstream code keeps
seeing `ModelSelection`. Additive; the object form is unchanged.

## Design (grounded in the codebase seam map)

`model` enters at exactly TWO public boundaries and is consumed downstream via `model.id` / `model.params`.
Normalize at the boundary; internal types stay `ModelSelection`.

### The one normalizer (`src/internal/runtime/model-selection.ts`, NEW, pure)

```ts
export function normalizeModel(m: string | ModelSelection | undefined): ModelSelection | undefined
// string → { id: trimmed }; validates non-empty (else ConfigurationError code "invalid_model_selection");
// ModelSelection / undefined pass through unchanged.
```

`"inherit"` is an `AgentOptions`-only sentinel (subagent inherits parent model) — handled inline at the
create seam, NOT inside `normalizeModel` (keeps the helper `string | ModelSelection → ModelSelection`).

### Type changes (public surface)

- `AgentOptions.model?: ModelSelection | "inherit"` → `string | ModelSelection | "inherit"`.
- `SendOptions.model?: ModelSelection` → `string | ModelSelection`.
- Internal `applyModelOverride` param decoupled to `ModelSelection | undefined` (already is at the impl).

### Seams (3 call sites of the one helper)

1. **Create** — `runCreateUnderSpan(options, span)` (`agent-helpers.ts:29`): normalize `options.model`
   once (`"inherit"` passthrough). Covers create / prompt / factory / builder / batch (all → `Agent.create`).
2. **Local send override** — `local-agent-send.ts:86` `applyModelOverride(normalizeModel(options.model))`.
3. **Cloud send override** — `cloud-agent.ts:131` `const overrideModel = normalizeModel(options.model)`.

## Coverage Matrix

| DoD claim | Task | Test |
|---|---|---|
| `AgentOptions.model` + `SendOptions.model` accept `string \| ModelSelection`; normalized at one seam | T1 (types), T2 (normalizer) | unit + integration |
| Back-compat: `{ id }` / `{ id, params }` unchanged | T2 | passthrough test |
| string resolves identically to `{ id }`; provider prefix routes; params still object | T3 (create), T4 (send) | fixture run → RunResult.model; empty string → ConfigurationError |
| Docs + Changeset; examples updated | T5 | — |

## Drawbacks & Risks

1. `ModelSelection.params` needs the object form. Mitigation: string covers the common no-params case;
   documented that params tuning requires `{ id, params }`.
2. A call site typed only as `ModelSelection` silently rejects a string. Mitigation: normalize once at
   each public boundary; internal stays `ModelSelection` (audited: 3 boundaries, all covered).
3. `"inherit"` string vs a real id. Mitigation: `"inherit"` handled inline at the create seam only;
   `SendOptions` never carried it.

## Unresolved Questions

(none) — pure additive boundary normalization; the id resolver (`parseModelId`) already parses `provider/model`.
