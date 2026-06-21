# Blueprint: M3-5 — ACI description override + render `<tools>`

> Design source for `withDescription(tool, description): CustomTool` + `renderToolList(tools): string` in `@theokit/sdk-tools` — override a tool's LLM-facing description immutably, and render a `<tools>` block FROM THE SAME `CustomTool[]` the agent runs (single source of truth, no drift). Backed by opencode (`tool/AGENTS.md` — `Tool.make({description})` canonical + immutable), codex (`code-mode/src/description.rs` tool-description generation, `core/templates/search_tool/tool_description.md` template), the in-repo Hermes tool-registry pattern (`sdk-references/tool-registry-pattern.md` — `ToolEntry` + `getAvailableTools` render-from-array), and the M3-4 clone-with-override mirror (`internal/tool-guidance.ts:68`). Discovery plan: `m3-aci-tools` (discover-plan-confidence SHIPPABLE 99.5).

**Slug:** `m3-aci-tools` · **Date:** 2026-06-21 · **Owner:** paulo

## Context

Greenfield: no `withDescription`/`renderToolList`/`<tools>` rendering. `CustomTool` (`packages/sdk/src/types/agent-prims.ts:46-64`) is a plain object (name/description/inputSchema/handler) — overriding `description` is a clone-with-override (the M3-4 pattern), and rendering is a string template over the array. The ACI insight (gap audit): a tool's description "drives tool-selection accuracy" and should be tunable; the rendered list must not drift from the real tools.

## Objective

Decide `withDescription(tool, description): CustomTool` (immutable override) + `renderToolList(tools, opts?): string` (a `<tools>` block read from the agent's actual `CustomTool[]`) + the escaping/empty handling — zero new deps. Backed by opencode + codex + the in-repo Hermes pattern + the M3-4 mirror.

## Coverage Corner 1 — Integration Tests

| Source | What it tests | Seeds these SDK RED tests |
|---|---|---|
| in-repo `sdk-references/tool-registry-pattern.md` (`getAvailableTools`) | the rendered list is the array the agent uses | `renderToolList(tools)` lists every tool's name+description; reflects a `withDescription`-overridden description (no drift) |
| opencode `tool/AGENTS.md` (immutable `Tool.make`) | a tool is immutable; override → new instance | `withDescription(tool, "x")` returns a new tool with description "x"; the ORIGINAL tool's description is unchanged |
| in-repo M3-4 `tool-guidance.test.ts` (clone-preserves-shape) | clone preserves name/inputSchema/handler | `withDescription` preserves name/inputSchema/handler; only description changes |

**SDK RED test set:** `withDescription` overrides only description (original untouched, name/inputSchema/handler preserved); `renderToolList` emits a `<tools>` block with each name+description; an overridden description appears in the render (single source, no drift); an empty array → a well-formed empty `<tools>` block; a description with `<`/`>`/`&` is escaped so the block stays parseable.

## Coverage Corner 2 — Dependencies

| Project | Override/render deps | Portable? |
|---|---|---|
| opencode | Effect runtime (`Tool.make`) | NO |
| codex | Rust template engine | concept only |
| in-repo | object spread + string join | YES — direct |

**Verdict:** ZERO new deps — `withDescription` is `{ ...tool, description }`; `renderToolList` is a string template with minimal XML-escaping. Pure (Unbreakable Rule 9 / KISS).

## Coverage Corner 3 — Tools

Module / export shape:
- `CustomTool` (`packages/sdk/src/types/agent-prims.ts:46-64`): plain object, `description` "drives tool-selection accuracy".
- M3-4 clone-with-override (`packages/sdk-tools/src/internal/tool-guidance.ts:68-75`): builds a CustomTool literal preserving name/inputSchema/handler, overriding one field — the exact mirror.
- in-repo Hermes `getAvailableTools` (`.claude/knowledge-base/sdk-references/tool-registry-pattern.md`): returns the `ToolEntry[]` that IS the render source.
- codex `code-mode/src/description.rs` (`.claude/knowledge-base/reference/codex/codex-rs/code-mode/src/description.rs`): generates a tool description string; `core/templates/search_tool/tool_description.md` is a rendered description template.

**SDK module shape:** `packages/sdk-tools/src/internal/tool-aci.ts`, barrel-exported:
```
withDescription(tool: CustomTool, description: string): CustomTool   // immutable override
renderToolList(tools: CustomTool[]): string                          // <tools> block from the same array
```

## Coverage Corner 4 — Techniques

### Technique 1 — immutable description override (Q4)

```
withDescription(tool, description):
  return { name: tool.name, description, inputSchema: tool.inputSchema, handler: tool.handler }
```
Returns a NEW CustomTool; the original object is not mutated (opencode immutability + M3-4 mirror). Preserves name/inputSchema/handler exactly.

### Technique 2 — render `<tools>` from the same array, escaped + empty-safe (Q5)

```
renderToolList(tools):
  if tools.length === 0 return "<tools></tools>"
  lines = ["<tools>"]
  for t in tools:
    lines.push(`  <tool>`)
    lines.push(`    <name>${esc(t.name)}</name>`)
    lines.push(`    <description>${esc(t.description)}</description>`)
    lines.push(`  </tool>`)
  lines.push("</tools>")
  return lines.join("\n")
esc(s) = s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")   // EC-1
```
Reads the SAME `CustomTool[]` the agent runs → no drift (single source of truth). An overridden description (via `withDescription`) is reflected automatically because the same array is rendered. Empty array → `<tools></tools>` (never throws). Pure prompt aid (not the provider wire schema — that stays `inputSchema`, EC-3).

## Cross-cutting Comparison

| Dimension | codex | opencode | in-repo Hermes | SDK decision |
|---|---|---|---|---|
| description | generated/template | canonical `Tool.make` field | `ToolEntry.description` | `CustomTool.description`, overridable |
| override | regenerate | new immutable instance | new entry | `{ ...tool, description }` new instance |
| render source | registry | registry | `getAvailableTools` array | the passed `CustomTool[]` (no parallel list) |
| deps | Rust template | Effect | none | none |
| mutates original? | n/a | no | no | NO |

## ADRs

### D1 — Two pure functions: immutable override + array render
**Decision:** `withDescription(tool, description): CustomTool` (clone-with-override) + `renderToolList(tools): string` (`<tools>` from the same array).
**Rationale:** mirrors M3-4 + opencode immutability; the render reads the agent's real array so it cannot drift. Zero deps.
**Alternatives considered:** mutate the tool in place (rejected — shared-state bug); a separate tool registry to render from (rejected — drift, the exact thing the gap audit warns against).

### D2 — Override preserves all other fields, original untouched
**Decision:** `{ name, description, inputSchema, handler }` with only `description` replaced; original object not mutated.
**Rationale:** immutability (opencode) + contract fidelity (M3-4).
**Alternatives considered:** `Object.assign(tool, {description})` (rejected — mutates the original).

### D3 — renderToolList reads the SAME array (single source of truth)
**Decision:** `renderToolList(tools)` takes the same `CustomTool[]` the agent is configured with; no parallel registry.
**Rationale:** "Override + render de single source, sem drift" — the render is derived from the live tools, so an override or an added/removed tool is reflected automatically.
**Alternatives considered:** a maintained description catalog rendered separately (rejected — guaranteed to drift).

### D4 — Escape description text + empty-safe (never throws)
**Decision:** XML-escape `&`/`<`/`>` in name+description; an empty array → `<tools></tools>`.
**Rationale:** a description with angle brackets must not malform the block (EC-1); empty is a valid state (EC-3).
**Alternatives considered:** no escaping (rejected — malformed block); throw on empty (rejected — empty is valid).

### D5 — Placement + barrel export
**Decision:** `packages/sdk-tools/src/internal/tool-aci.ts`; barrel-export `withDescription`, `renderToolList`.
**Rationale:** sibling of `tool-guidance.ts`; internal/ for logic, barrel for reuse.
**Alternatives considered:** in `@theokit/sdk` core (rejected — it operates on sdk-tools' CustomTool surface, belongs with the tooling helpers).

## Recommendations for the project

1. Implement `withDescription(tool, description)` (immutable clone-with-override) + `renderToolList(tools)` (`<tools>` from the same array) in `packages/sdk-tools/src/internal/tool-aci.ts`, zero deps, barrel-exported (D1/D5).
2. Override preserves name/inputSchema/handler and never mutates the original (D2).
3. Render from the agent's live `CustomTool[]` — no parallel registry — so override/add/remove is reflected automatically (D3, no drift).
4. XML-escape name+description; empty array → `<tools></tools>`; never throw (D4).
5. TDD: override-only-description + original-untouched; render lists name+desc; overridden description reflected in render (no drift); empty array; angle-bracket description escaped.

## Blocked questions (if any)

- (none) — design fully resolved; both functions are pure, zero-dep, and compose over the existing CustomTool surface.
