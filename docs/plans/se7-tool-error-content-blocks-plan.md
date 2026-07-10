# SE7 — Structured/multimodal tool results + `ToolError` — Plan

**Milestone:** SE7 (SDK Evolution). User-requested tool-ergonomics feature.
Decisions locked with the user: **symmetric** (success return + error throw may be multimodal) and
**fail-fast** (typed `ConfigurationError` for providers without image-in-tool-result support — no silent
degradation, per `error-handling.md`). Naming is **capability-based** (block-capable vs string-only
provider), never provider-specific.

## Design (grounded in the codebase seam map)

Today the tool pipeline is string-only (`ToolResult = {stdout, stderr, exitCode}`,
`LlmToolResultPart.content: string`). `isError` already flows end-to-end. Persistence/replay is
EVENT-based (`replay-history.ts`), NOT `LlmToolResultPart.content` — so multimodal content on the LLM
message does not touch SE4/persistence. The only `content`-as-string consumers are the guard + the
three wire mappers.

### New types (`src/types/messages.ts`)

```ts
export interface ImageBlock { type: "image"; source: { type: "base64"; media_type: string; data: string } }
export type ToolResultContentBlock = TextBlock | ImageBlock;
```

### `ToolError` (`src/errors.ts`)

`class ToolError extends TheokitAgentError` — `content: string | ToolResultContentBlock[]`;
`isRetryable: false`; the `Error.message` is the string (or a text rendering of the blocks).

### Handler surface (`src/types/agent-prims.ts`)

`CustomTool.handler` return widened to `string | ToolResultContentBlock[] | Promise<...>`. String stays
back-compat.

### Execution (`tool-executors.ts`)

`ToolResult.content?: ToolResultContentBlock[]` (structured, authoritative when set).
- success: handler returns string → legacy `{stdout}`; returns array → `{stdout:"", exitCode:0, content: blocks}`.
- catch `ToolError` → normalize to blocks (`string` → single text block), `{exitCode:1, content: blocks}` (isError).
- catch plain `Error` → unchanged (message string, isError).

### Tool-result build (`tool-dispatch.ts:finalizeSpanAndPostHook`)

`content: result.content ?? renderToolResult(result)`; `isError` from `exitCode` (unchanged).

### Wire (`llm/types.ts`: `LlmToolResultPart.content: string | ToolResultContentBlock[]`)

Shared, **capability-named** helpers in NEW `src/internal/llm/tool-result-content.ts`:
- `toBlockToolResultContent(content)` — for block-capable provider wires. string → string; array → structured `[{type:text},{type:image,source}]`.
- `toStringToolResultContent(content, providerName)` — for string-only provider wires. string → string; array with an image → **throw `ConfigurationError`**; text-only → join.
- `renderToolResultContentText(content, fn)` — apply `fn` to text parts (for the guard), pass images.

Applied at: the block-capable provider wire mapper (native), the string-only provider wire mappers (fail-fast), `tool-result-guard.ts` (text guard).

### Exports (`src/index.ts`)

`ToolError`, `ImageBlock`, `ToolResultContentBlock`.

## Coverage Matrix

| DoD claim | Test |
|---|---|
| ImageBlock + ToolResultContentBlock + ToolError | unit: ToolError construction (string + blocks) |
| handler returns blocks (symmetric success) | executor: array return → ToolResult.content blocks |
| ToolError thrown → tool_result isError + blocks | executor: ToolError catch → content blocks + exitCode 1 |
| block-capable wire carries blocks natively | pure helper: `toBlockToolResultContent` (text + image) |
| string-only wire + image → ConfigurationError; text-only → string | pure helper: `toStringToolResultContent` (fail-fast + flatten) |
| Docs + Changeset | — |

## Drawbacks & Risks

1. String-consumer breakage. Mitigation: `content: string | blocks` + render helper; persistence is
   event-based, untouched. Every existing string path keeps working (string branch).
2. Provider divergence. Mitigation: typed `ConfigurationError` fail-fast (user-chosen), not silent drop.

## Unresolved Questions

(none) — success `handler` string return and plain-`Error` throw are both unchanged (back-compat).
