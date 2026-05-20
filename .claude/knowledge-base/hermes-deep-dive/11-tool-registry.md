# 11 — Tool Registry (Cross-Cutting)

> Hermes ships 98 tool files under `tools/*.py`. Each calls
> `registry.register(...)` at import time. `tools/registry.py` (563 LoC)
> is the central in-memory registry: tool name → schema + handler + check_fn
> + emoji + size cap. `discover_builtin_tools` walks the directory and
> imports every file whose AST contains a top-level `registry.register()`
> call (AST inspection, not eager import — avoids importing modules that
> only define helpers). `toolsets.py` (866 LoC) is a parallel layer: which
> tools are *exposed to the model* per-platform. `_HERMES_CORE_TOOLS` is
> the default bundle. `check_fn` results are TTL-cached for 30s so
> availability probes don't run on every turn. In TypeScript:
> `defineTool(spec)` registration via the SDK's `Toolset` system —
> already established in D24 (`defineTool` schema source = Zod) — but with
> the Hermes additions: per-platform toolsets, check_fn TTL cache, and
> dynamic_schema_overrides.

## What problem this domain solves

Three nested concerns:

1. **Registration**: how does a new tool get into the agent's schema? Naïve answer: a giant `TOOLS = {…}` dict in a single file. Doesn't scale. Hermes' answer: each tool file calls `registry.register(...)` at top-level, autodiscovery imports them all.

2. **Exposure**: even if a tool is registered, when should the model SEE it? A Telegram-bound agent shouldn't see SSH-only tools. A worker scoped to a kanban task shouldn't see general delegation tools. Hermes' answer: `toolsets.py` defines per-platform bundles (toolsets); each platform's adapter picks a base toolset.

3. **Availability**: even if exposed, is the tool *usable* right now? `browser_*` tools require playwright installed. `image_generate` requires an API key. Hermes' answer: `check_fn` returns bool; TTL-cached for 30s so the probe doesn't run on every turn.

These three layers compose: registration → toolset membership → availability check. Each layer can mutate independently (new tool file → register; new platform → toolset; missing API key → check_fn fails). The agent's tool-schema generation pulls them all together at turn time.

## Hermes file layout

| File | LoC | Role |
|---|---|---|
| `tools/registry.py` | 563 | `ToolRegistry`, `ToolEntry`, `discover_builtin_tools`, `check_fn` TTL cache. |
| `tools/__init__.py` | small | Package init. |
| `tools/*.py` (~98 files) | varies | Per-tool implementations. Each calls `registry.register(...)`. |
| `toolsets.py` | 866 | `_HERMES_CORE_TOOLS`, `TOOLSETS` dict, per-platform mapping. |
| `model_tools.py` (referenced) | — | `get_tool_definitions(enabled_toolsets, …)` — assembles the schema for an agent turn. |

## Canonical entry points

```python
# tools/registry.py:151
class ToolRegistry:
    """Central registry. One instance per process."""

    def register(self, name, toolset, schema, handler, *,
                 check_fn=None, requires_env=None, is_async=False,
                 description=None, emoji=None, max_result_size_chars=None,
                 dynamic_schema_overrides=None) -> ToolEntry: ...

    def get_definitions(
        self,
        enabled_toolsets: Optional[List[str]] = None,
        disabled_toolsets: Optional[List[str]] = None,
        quiet_mode: bool = False,
    ) -> List[Dict[str, Any]]: ...

    def get_handler(self, name: str) -> Optional[Callable]: ...
```

```python
# tools/registry.py:57
def discover_builtin_tools(tools_dir: Optional[Path] = None) -> List[str]:
    """Import built-in self-registering tool modules and return their module names."""
```

```python
# toolsets.py — module-level
_HERMES_CORE_TOOLS = [
    "web_search", "web_extract", "terminal", "process",
    "read_file", "write_file", "patch", "search_files",
    "vision_analyze", "image_generate",
    "skills_list", "skill_view", "skill_manage",
    "browser_navigate", "browser_snapshot", "browser_click", …
    "text_to_speech", "todo", "memory", …
]

TOOLSETS: Dict[str, List[str]] = {…}
```

## Architectural decisions

### AD-1: AST inspection for safe autodiscovery

- **Decision**: `discover_builtin_tools` parses each `tools/*.py` file's AST and only imports the ones with a top-level `registry.register(...)` call.

- **Evidence**: `tools/registry.py:29-55`:

  ```python
  def _is_registry_register_call(node: ast.AST) -> bool:
      """Return True when *node* is a ``registry.register(...)`` call expression."""
      if not isinstance(node, ast.Expr) or not isinstance(node.value, ast.Call):
          return False
      func = node.value.func
      return (
          isinstance(func, ast.Attribute)
          and func.attr == "register"
          and isinstance(func.value, ast.Name)
          and func.value.id == "registry"
      )
  ```

- **Rationale**: Helper modules in `tools/` (utilities, shared types) shouldn't trigger registration. AST inspection finds only the ones that actually register. Avoids importing modules with expensive side-effects unnecessarily.

- **TypeScript translation**: Imports in JS are explicit (no autodiscovery). We instead use a `defineTool(spec)` pattern with explicit re-exports from a barrel file. Cleaner than AST inspection.

### AD-2: One registration call per tool, at module load

- **Decision**: Each `tools/<name>.py` calls `registry.register(name=..., toolset=..., schema=..., handler=..., ...)` at the top level. The import side-effect populates the registry.

- **Evidence**: AGENTS.md:280-296 documents the pattern.

- **Rationale**: Tools live with their handlers. No separate "tools.yaml" registry file that drifts from code.

- **TypeScript translation**: `defineTool({...})` returns a `Tool` object. A barrel file (`packages/sdk/src/tools/index.ts`) re-exports each. SDK consumers `import { theKanbanTools } from "@usetheo/sdk"` and pass the toolset to `Agent.create({ tools })`.

### AD-3: Auto-discovery imports — but toolset wiring is manual

- **Decision**: Auto-discovery imports all `tools/*.py` files automatically. But a tool only becomes *visible to an agent* if its name appears in a toolset in `toolsets.py`.

- **Evidence**: AGENTS.md:298-300:

  > Add to ``toolsets.py`` — either ``_HERMES_CORE_TOOLS`` (all platforms) or a new toolset. **This step is required:** auto-discovery imports the tool and registers its schema, but the tool is only *exposed to an agent* if its name appears in a toolset. ``_HERMES_CORE_TOOLS`` is not dead code — it's the default bundle every platform's base toolset inherits from.

- **Rationale**: A registered-but-unexposed tool is fine — perhaps it's gated by an env var. The author intentionally chooses *when* to expose it via the toolset.

- **TypeScript translation**: Tools are explicitly registered (no autodiscovery). Toolsets are explicit groupings: `const messagingToolset: Tool[] = [terminalTool, webSearchTool, ...]`.

### AD-4: `check_fn` TTL cache amortizes availability probes

- **Decision**: `check_fn` (returns bool, "is this tool available right now?") is TTL-cached for 30s. Repeat probes within 30s return cached value.

- **Evidence**: `tools/registry.py:121-148`:

  ```python
  _CHECK_FN_TTL_SECONDS = 30.0
  _check_fn_cache: Dict[Callable, tuple[float, bool]] = {}
  _check_fn_cache_lock = threading.Lock()

  def _check_fn_cached(fn: Callable) -> bool:
      """Return bool(fn()), TTL-cached across calls. Swallows exceptions as False."""

  def invalidate_check_fn_cache() -> None:
      """Drop all cached ``check_fn`` results. Call after config changes that
      ...
  ```

- **Rationale**: `check_terminal_backend_available()` probes the docker socket. Doing that on every turn is wasteful. 30s TTL is short enough that `hermes tools enable foo` takes effect promptly, long enough to avoid spamming probes. After config changes, code calls `invalidate_check_fn_cache()` to force re-probe.

- **TypeScript translation**: Same TTL cache. WeakMap keyed by the check function. 30s default, configurable.

### AD-5: ToolEntry holds emoji + description for the UI

- **Decision**: `ToolEntry` (the registered metadata) includes `emoji` and `description` for CLI/TUI display. The agent loop doesn't use them; the display layer does.

- **Evidence**: `tools/registry.py:77-104`:

  ```python
  class ToolEntry:
      __slots__ = (
          "name", "toolset", "schema", "handler", "check_fn",
          "requires_env", "is_async", "description", "emoji",
          "max_result_size_chars", "dynamic_schema_overrides",
      )
  ```

- **Rationale**: Centralizes UI metadata. The skin engine reads `tool_emojis` from the active skin (AGENTS.md:407-409); the registry holds the canonical fallback.

- **TypeScript translation**: `defineTool({ name, schema, handler, emoji?, description?, ... })`. Same pattern.

### AD-6: `max_result_size_chars` per tool

- **Decision**: Each tool can specify a maximum result size. Results exceeding it get truncated (head + tail) or saved to a temp file.

- **Evidence**: `tools/registry.py:84` (`max_result_size_chars`). Plus PR #5210 (v0.8): "Save oversized tool results to file instead of destructive truncation."

- **Rationale**: A `ls -laR /` would otherwise blow up the context window. Per-tool caps let `search_files` have a higher limit than `terminal`.

- **TypeScript translation**: `defineTool({ ..., maxResultSizeChars: 50000 })`. Default cap of 10000 chars; SDK truncates with marker.

### AD-7: `dynamic_schema_overrides` for runtime schema mutation

- **Decision**: Tools can register a zero-arg callable that returns schema patches applied at `get_definitions()` time. Lets schema descriptions reference live config (e.g. `display_hermes_home()`).

- **Evidence**: `tools/registry.py:88-89`:

  ```python
  # Optional zero-arg callable returning a dict of schema overrides
  # applied at get_definitions() time. Use for fields that depend on
  ```

- **Rationale**: Schema descriptions are generated at import time, *after* `_apply_profile_override()` sets `HERMES_HOME`. But some fields need *very* late binding — runtime config that hadn't been loaded at import time.

- **TypeScript translation**: `defineTool({ ..., dynamicSchema: () => ({ description: `paths under ${getTheokitHome()}` }) })`. Lazy evaluation at schema-build time.

### AD-8: `requires_env` declarative

- **Decision**: Tools declare `requires_env: list[str]` of env vars they need. Used both for `check_fn` defaults and for docs / setup wizard.

- **Evidence**: `tools/registry.py:80-81` (`requires_env`). AGENTS.md:289-295 shows the canonical example.

- **Rationale**: A tool that needs `EXAMPLE_API_KEY` shouldn't have to write a custom `check_fn` for the common "is this env var set?" case. The registry's default `check_fn` checks `requires_env`.

- **TypeScript translation**: `defineTool({ ..., requiresEnv: ["EXAMPLE_API_KEY"] })`. Default `check_fn` checks `process.env`.

### AD-9: Handlers MUST return a JSON string

- **Decision**: Every tool handler returns a JSON string. The dispatch layer parses it back into a dict if needed.

- **Evidence**: AGENTS.md:303:

  > All handlers MUST return a JSON string.

- **Rationale**: Uniform shape for the model. The LLM gets text; whether the tool naturally produces JSON, a string, or a dict, it goes over the wire as JSON-encoded text.

- **TypeScript translation**: `Tool.handler(args): Promise<string>`. Same contract.

### AD-10: `_last_resolved_tool_names` is a process-global with save/restore around subagents

- **Decision**: `model_tools.py` maintains a process-global `_last_resolved_tool_names`. `delegate_tool.py` saves and restores it around child agent execution.

- **Evidence**: AGENTS.md:940-942:

  > ``_run_single_child()`` in ``delegate_tool.py`` saves and restores this global around subagent execution. If you add new code that reads this global, be aware it may be temporarily stale during child agent runs.

- **Rationale**: Subagents have a *narrower* toolset than parents. The global gets mutated by the parent's tool resolution. Without save/restore, the parent would see the child's narrower set after delegation.

- **TypeScript translation**: We avoid this anti-pattern in TS. State per-agent, not process-global. `AsyncLocalStorage` if cross-async-call state needed; not module-level globals.

### AD-11: Schema descriptions must NOT reference other toolsets

- **Decision**: Tool schema descriptions cannot say "prefer web_search over this" because `web_search` may be unavailable. Cross-references happen dynamically in `model_tools.py:get_tool_definitions()`.

- **Evidence**: AGENTS.md:944-946:

  > Tool schema descriptions must not mention tools from other toolsets by name (e.g., ``browser_navigate`` saying "prefer web_search"). Those tools may be unavailable (missing API keys, disabled toolset), causing the model to hallucinate calls to non-existent tools. If a cross-reference is needed, add it dynamically in ``get_tool_definitions()`` in ``model_tools.py``.

- **Rationale**: Models try to call any tool you mention. If you describe `web_search` in `browser_navigate`'s docs but `web_search` isn't enabled, the model hallucinates calls to it.

- **TypeScript translation**: Same discipline. ESLint rule could catch hardcoded tool names in description strings.

### AD-12: Plugins register tools via `ctx.register_tool` — same registry

- **Decision**: General plugins (per AGENTS.md:467-490) register tools through `ctx.register_tool(...)` which delegates to `registry.register`. Plugin tools and built-in tools share the same registry.

- **Evidence**: AGENTS.md:475-479. Plus PR #5295 (v0.8): "Plugin CLI registration system."

- **Rationale**: One registry. No "plugin tools" vs "built-in tools" dichotomy in dispatch. Treats both equally.

- **TypeScript translation**: `Plugin` exposes a `ctx.registerTool(spec)` method that delegates to the same `Toolset.add` API users call directly.

## Data structures

### `ToolEntry` (in-memory)

```python
class ToolEntry:
    name: str
    toolset: str
    schema: Dict[str, Any]
    handler: Callable
    check_fn: Optional[Callable[[], bool]]
    requires_env: List[str]
    is_async: bool
    description: str
    emoji: str
    max_result_size_chars: Optional[int]
    dynamic_schema_overrides: Optional[Callable[[], Dict[str, Any]]]
```

### `ToolRegistry` (in-memory)

- `self._tools: Dict[str, ToolEntry]` — registered tools by name
- `self._generation: int` — bumped on every `register` / `unregister`
- `self._lock: threading.Lock` — register/unregister serialization

### `TOOLSETS` (module-level dict in `toolsets.py`)

```python
TOOLSETS = {
    "messaging": [...messaging tools list],
    "cli": [...cli tools list],
    "telegram": [...telegram-specific list],
    "kanban": [...kanban worker tools],
    ...
}
```

Per AGENTS.md:686-689, current toolset keys (29 of them): `browser`, `clarify`, `code_execution`, `cronjob`, `debugging`, `delegation`, `discord`, `discord_admin`, `feishu_doc`, `feishu_drive`, `file`, `homeassistant`, `image_gen`, `kanban`, `memory`, `messaging`, `moa`, `rl`, `safe`, `search`, `session_search`, `skills`, `spotify`, `terminal`, `todo`, `tts`, `video`, `vision`, `web`, `yuanbao`.

### Concurrency model

- **Register** serialized via `self._lock`.
- **Read** (`get_definitions`, `get_handler`) lock-free; uses a generation counter for cache invalidation.
- **`check_fn` cache** has its own `_check_fn_cache_lock`.

## Failure modes Hermes already fixed

1. **Tool name collisions** — MCP tool name deconfliction (v0.5 #3077, v0.9 #7654).
2. **Tool registry import failures swallow errors** — fixed to log at WARNING level.
3. **Helper modules auto-discovered as tools** — fixed by AST-only top-level inspection.
4. **`check_fn` runs on every turn** — fixed by 30s TTL cache.
5. **Tool result blows context window** — `max_result_size_chars` cap + save-to-file fallback (v0.8 #5210).
6. **`_last_resolved_tool_names` global stale during subagent** — fixed by save/restore in delegate_tool.py.
7. **Schema description references unavailable tools causes hallucination** — fixed by dynamic resolution in `model_tools.get_tool_definitions()`.
8. **Plugin tool name conflicts with built-in** — `register_tool` validates uniqueness.
9. **Tool schema with `None` content** — input validation.
10. **`is_async` mismatch causes deadlock** — explicit per-tool flag.

## TypeScript API proposal

### Public surface

```typescript
// src/index.ts (extends D24)
export function defineTool<TArgs, TResult>(spec: ToolSpec<TArgs, TResult>): Tool<TArgs, TResult>;
export class Toolset {
  static define(name: string, tools: Tool<any, any>[]): Toolset;
  static compose(name: string, ...toolsets: Toolset[]): Toolset;
}

declare module "./agent" {
  interface AgentOptions {
    tools?: Tool<any, any>[];      // Direct list
    toolsets?: Toolset[];           // Or toolsets to compose
    disabledTools?: string[];       // Subtract from the assembled set
  }
}

export interface ToolSpec<TArgs, TResult> {
  name: string;
  description: string;
  parameters: ZodSchema<TArgs>;
  handler: (args: TArgs, ctx: ToolContext) => Promise<TResult> | TResult;
  // Hermes additions:
  emoji?: string;
  toolset?: string;
  requiresEnv?: string[];
  checkFn?: () => boolean | Promise<boolean>;  // TTL-cached 30s
  maxResultSizeChars?: number;
  dynamicSchema?: () => Partial<ToolSpec<TArgs, TResult>>;
}
```

### Internal module layout

```
packages/sdk/src/internal/tools/
├── registry.ts                  # Tool registry, generation counter
├── define-tool.ts               # defineTool helper
├── check-fn-cache.ts            # 30s TTL cache for check_fn results
├── toolset.ts                   # Toolset class — define + compose
└── dispatch.ts                  # Handler invocation with timeout + size cap
```

### Migration impact on v1.2 users

- **Backward-compatible**: D24 (`defineTool` schema source = Zod) is already established. We extend it with Hermes' additional fields. Existing tools work unchanged.

## Test strategy

- Registry: register, get_definitions, get_handler, generation increment.
- check_fn cache: TTL respected, invalidation works.
- Toolset composition: nested toolsets resolve correctly.
- AST inspection: file with helper-only registry.register inside a function is NOT imported.
- Schema description discipline: ESLint rule that catches hardcoded tool names in descriptions.

## Open questions

- **AST inspection vs explicit re-exports**: Hermes uses AST for autodiscovery. TypeScript prefers explicit imports. Recommend explicit `defineTool` + barrel re-export.
- **Tool emoji conflicts with skin engine**: Hermes' skin engine can override emojis per-skin. Do we need a similar system?
- **`dynamic_schema_overrides` complexity**: rarely needed. Document as advanced; provide example only for the canonical use case (paths with HERMES_HOME).

## References

- `referencia/hermes-agent/tools/registry.py:1-563`
- `referencia/hermes-agent/toolsets.py:1-866` (especially `_HERMES_CORE_TOOLS:30-` and `TOOLSETS` dict)
- AGENTS.md:264-308 — Adding tools
- AGENTS.md:676-691 — Toolsets
- AGENTS.md:940-946 — Cross-tool reference hazard
- Theokit ADRs:
  - D24 — `defineTool` schema source = Zod
  - D25 — `Agent.builder()` API shape
