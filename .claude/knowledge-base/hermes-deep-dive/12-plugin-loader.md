# 12 — Plugin Loader (Cross-Cutting)

> `hermes_cli/plugins.py` (1550 LoC) is the general PluginManager.
> Plugins live in `~/.hermes/plugins/<name>/` (user), `./.hermes/plugins/`
> (project), pip entry points, and `<repo>/plugins/<name>/` (bundled).
> Each plugin's `register(ctx)` function declares lifecycle hooks
> (`pre_tool_call`, `post_tool_call`, `pre_llm_call`, `post_llm_call`,
> `on_session_start`, `on_session_end`, `transform_terminal_output`,
> `transform_tool_result`, `transform_llm_output`) and registers tools
> + CLI subcommands + slash commands. **Three separate discovery
> systems** in Hermes — general PluginManager, memory-provider
> plugins (doc 05), and model-provider plugins (doc 07) — chosen
> deliberately because mixing them caused double-instantiation bugs.
> The general PluginManager records all three kinds but only *imports*
> general plugins. Per-plugin enable/disable via `disabled` config +
> env var override. PR #5295 (v0.8) removed 95 lines of hardcoded
> honcho argparse from `main.py`; the rule "**plugins MUST NOT modify
> core files**" is the hard line from Teknium. In TypeScript: a single
> typed `Plugin` interface, three plugin *kinds* (general / memory /
> provider) in one registry, no AST autodiscovery — explicit imports
> only.

## What problem this domain solves

Plugins exist because Hermes can't ship every integration. Users want to extend Hermes with their own tools, hooks, CLI commands without forking. The plugin system is the well-defined extension surface.

The hard part: extensibility without breaking core. Pre-v0.8, the honcho memory provider's CLI subcommands were *hardcoded* into `main.py` — 95 lines. Every memory provider author wanted the same treatment. PR #5295 cleaned this up: plugins register their own CLI surface; core never knows their name.

Three discovery systems coexist for a reason: each plugin *kind* has different lifetime + invocation patterns. General plugins fire on every tool call (high frequency, must be imported eagerly). Memory plugins are activated at agent init and persist for the session (one external per agent). Model-provider plugins are stateless catalog entries (lazy-discoverable, last-writer-wins for overrides).

## Hermes file layout

| File | LoC | Role |
|---|---|---|
| `hermes_cli/plugins.py` | 1550 | `PluginManager`, `PluginManifest`, `LoadedPlugin`, `PluginContext`. The whole general system. |
| `plugins/<name>/__init__.py` | varies | Each plugin's entry. Defines `register(ctx)`. |
| `plugins/<name>/plugin.yaml` | small | Plugin manifest (`name`, `kind`, `version`, `description`, `requires`). |

Discovery roots:
- `<repo>/plugins/<name>/` — bundled
- `~/.hermes/plugins/<name>/` — user
- `./.hermes/plugins/<name>/` — project (opt-in per v0.4 #2215)
- pip entry points named `hermes.plugins`

## Canonical entry point

```python
# hermes_cli/plugins.py:287
class PluginContext:
    """Context object passed to every plugin's register() function.

    Plugins use ctx.register_tool, ctx.register_command, ctx.register_cli_command,
    ctx.inject_message, ctx.dispatch_tool to extend Hermes' behaviour.
    """

    def register_tool(self, name, handler, schema, *,
                      check_fn=None, toolset=None, requires_env=None,
                      is_async=False, description=None, emoji=None,
                      max_result_size_chars=None) -> None: ...

    def register_command(self, name, handler, description, *,
                         args_hint=None, aliases=None, category=None) -> None: ...

    def register_cli_command(self, name, parser_setup_fn, handler) -> None: ...

    def inject_message(self, content: str, role: str = "user") -> bool: ...

    def dispatch_tool(self, tool_name: str, args: dict, **kwargs) -> str: ...
```

Plus the lifecycle hooks plugins register via decorators:

```python
# hermes_cli/plugins.py:125-145 (approx)
_LIFECYCLE_HOOKS = [
    "pre_tool_call",
    "post_tool_call",
    "transform_terminal_output",
    "transform_tool_result",
    # plus newer ones:
    "transform_llm_output",
    "pre_llm_call",
    "post_llm_call",
    # session lifecycle:
    "on_session_start",
    "on_session_end",
]
```

## Architectural decisions

### AD-1: One PluginContext per plugin's `register(ctx)` call

- **Decision**: Plugins expose a single `register(ctx)` function. The PluginManager calls it once with a `PluginContext` instance scoped to that plugin. All registration goes through `ctx`.

- **Evidence**: `hermes_cli/plugins.py:287` (`class PluginContext`).

- **Rationale**: The context object is the *only* surface the plugin sees. No global mutation. Lets the manager track which plugin registered what for clean teardown.

- **TypeScript translation**: `Plugin.register(ctx: PluginContext): void`. Same pattern.

### AD-2: Lifecycle hooks are typed strings, not arbitrary functions

- **Decision**: Plugins register hooks for one of a fixed set: `pre_tool_call`, `post_tool_call`, `pre_llm_call`, `post_llm_call`, `on_session_start`, `on_session_end`, `transform_tool_result`, `transform_terminal_output`, `transform_llm_output`.

- **Evidence**: `hermes_cli/plugins.py:125-145`.

- **Rationale**: A fixed enum keeps the lifecycle predictable. Adding new hook points is a deliberate core change (and a feature announcement). Avoids hooks-of-hooks.

- **TypeScript translation**: `HookName` union type. Plugin's `register(ctx)` calls `ctx.on(hookName, handler)`.

### AD-3: `pre_tool_call` can veto (returns block message)

- **Decision**: A `pre_tool_call` hook may return a string to *block* the tool call. The agent loop checks for this and skips the call, surfacing the message to the model.

- **Evidence**: `hermes_cli/plugins.py:1385-1409`:

  ```python
  def get_pre_tool_call_block_message(...) -> str | None:
      """Check ``pre_tool_call`` hooks for a blocking directive.
      ...
      from their ``pre_tool_call`` callback.  The first valid block
      """
  ```

- **Rationale**: Plugins can enforce policies (e.g. "block terminal calls touching .ssh/"). The veto is structured, not exception-based, so the agent loop can recover gracefully.

- **TypeScript translation**: `PreToolCallHook` returns `void | string` (string = block reason). Same semantics.

### AD-4: `transform_*` hooks rewrite content as it flows

- **Decision**: `transform_terminal_output`, `transform_tool_result`, `transform_llm_output` let plugins intercept and rewrite the corresponding content stream.

- **Evidence**: `hermes_cli/plugins.py:129-137`. PR #12929 added `transform_terminal_output`; PR #12972 added `transform_tool_result`; PR #21235 added `transform_llm_output`.

- **Rationale**: A context-reducer plugin can shrink verbose tool outputs. A content filter can scrub PII. These are pure-function transforms, easier to compose than imperative side effects.

- **TypeScript translation**: `(content: string, ctx: TransformContext) => string | Promise<string>`. Composable.

### AD-5: `register_command` (slash) vs `register_cli_command` (argparse)

- **Decision**: Two distinct command-registration entry points. `register_command(name, handler, …)` registers a *slash command* visible in chat (CLI + gateway). `register_cli_command(name, parser_setup_fn, handler)` registers a `hermes <name>` *argparse subcommand* visible in the shell.

- **Evidence**: `hermes_cli/plugins.py:376-456`:

  ```python
  def register_cli_command(self, ...): ...
  def register_command(self, ...): ...   # docstring: Unlike register_cli_command...
  ```

- **Rationale**: Two surfaces. Slash commands run inside the chat session; subcommands run from the shell. PR #5295 added `register_cli_command`. PR #10626 added `register_command`.

- **TypeScript translation**: Same two methods on `PluginContext`. `ctx.registerCommand` for slash; `ctx.registerCliCommand` for argparse (using `commander` or similar).

### AD-6: `inject_message(content, role)` for plugins to drive the conversation

- **Decision**: Plugins can inject messages into the conversation as if the user typed them.

- **Evidence**: `hermes_cli/plugins.py:348` and PR #3778 (v0.6 by @winglian).

- **Rationale**: A plugin that watches a webhook can inject "New deploy succeeded!" as if the user pasted it. Lets plugins drive conversation without writing tools.

- **TypeScript translation**: `ctx.injectMessage(content: string, role: "user" | "system" = "user"): boolean`. Same.

### AD-7: `dispatch_tool(name, args)` for plugins to call other tools

- **Decision**: Plugins can invoke registered tools by name from their hook callbacks.

- **Evidence**: `hermes_cli/plugins.py:457` and PR #10763.

- **Rationale**: A plugin that observes `post_tool_call` may need to react with another tool call (e.g. notify on file change → call `send_message`). Avoids per-plugin reimplementation of every dispatch path.

- **TypeScript translation**: `ctx.dispatchTool(name, args): Promise<string>`. Returns the tool's JSON result.

### AD-8: Three separate discovery systems — by design

- **Decision**: General plugins, memory-provider plugins, and model-provider plugins each have their own discovery + registration. The general PluginManager records all three *kinds* of manifests but only *imports* the general ones.

- **Evidence**: AGENTS.md:541-549:

  > The general PluginManager records ``kind: model-provider`` manifests but does
  > NOT import them (would double-instantiate ``ProviderProfile``). Plugins
  > without an explicit ``kind:`` get auto-coerced via a source-text heuristic
  > (``register_provider`` + ``ProviderProfile`` in ``__init__.py``).

- **Rationale**: Memory and model providers have stricter contracts than general plugins (ABC compliance). Their discovery is lifecycle-aware. Mixing them caused double-instantiation in pre-v0.13 versions.

- **TypeScript translation**: We collapse to ONE registry with typed `kind: "general" | "memory" | "model-provider"`. The registry dispatches to the right activation path based on kind. Same end result, less complexity.

### AD-9: `plugin.yaml` manifest

- **Decision**: Every plugin has a `plugin.yaml` declaring at minimum: `name`, `kind`, `version`, and optional `description`, `requires`, `enabled`.

- **Evidence**: `hermes_cli/plugins.py:234` (`class PluginManifest`).

- **Rationale**: Lets the manager enumerate without importing. Cheap-to-read. Auto-coercion of `kind` via source-text heuristic only when manifest omits it.

- **TypeScript translation**: `plugin.json` (we're a Node ecosystem). Same fields.

### AD-10: Enable/disable via config + env var

- **Decision**: A plugin is enabled if (a) not in `disabled_plugins` config, AND (b) `HERMES_PLUGIN_<NAME>=1` env var (or no opt-out env var).

- **Evidence**: `hermes_cli/plugins.py:175-232` `_env_enabled`, `_get_disabled_plugins`, `_get_enabled_plugins`.

- **Rationale**: Lets users disable broken plugins without uninstalling them. Lets sysadmins force-enable specific plugins in containers.

- **TypeScript translation**: Same dual mechanism. `THEOKIT_PLUGIN_<NAME>` env var + `disabledPlugins` config field.

### AD-11: Plugin lifecycle: `register(ctx)` at load; `shutdown()` at exit

- **Decision**: Plugins implement `register(ctx)` for setup. `shutdown()` runs at process exit for cleanup.

- **Evidence**: `hermes_cli/plugins.py:271` `class LoadedPlugin`. Shutdown registered via `atexit`.

- **Rationale**: Plugins that hold resources (open connections, background threads) need a clean teardown hook.

- **TypeScript translation**: `Plugin.register(ctx)` returns optional `{ shutdown?: () => Promise<void> }`. SDK calls shutdown at `dispose`.

### AD-12: `discover_plugins(force=False)` is idempotent

- **Decision**: The discovery function can be called multiple times safely. Subsequent calls are no-ops unless `force=True`.

- **Evidence**: `hermes_cli/plugins.py:1352-1362` (`discover_plugins`).

- **Rationale**: Per AGENTS.md:487-489 — discovery happens as a side effect of importing `model_tools.py`. Other code paths that need plugins may call discover explicitly. Idempotency means no harm done.

- **TypeScript translation**: `PluginManager.discover({ force?: boolean })`. Same idempotency.

## Data structures

```python
class PluginManifest:
    name: str
    kind: str                  # "general" | "memory" | "model-provider" | "platform"
    version: str
    description: str
    requires: List[str]        # env vars
    enabled: bool              # default True
    source_path: Path

class LoadedPlugin:
    manifest: PluginManifest
    module: ModuleType         # imported Python module
    hooks: Dict[str, List[Callable]]
    tools: List[str]           # registered tool names
    cli_commands: List[str]    # registered CLI subcommand names
    slash_commands: List[str]  # registered slash command names
    shutdown_fn: Optional[Callable]

class PluginContext:
    plugin_name: str
    # Methods: register_tool, register_command, register_cli_command,
    #          inject_message, dispatch_tool, on (hook registration)
```

### Concurrency model

- **Discovery** uses a module-level lock to prevent concurrent discovery.
- **Hook invocation** is sequential — first hook fires before second. Per-plugin error handling: a raising hook doesn't block subsequent hooks.

## Failure modes Hermes already fixed

1. **Plugin tries to modify core files** — Rule: "plugins MUST NOT modify core files" (AGENTS.md:509-513). PR #5295 enforced this by removing 95 lines of hardcoded honcho argparse.
2. **Discovery imports double-instantiate ProviderProfile** — fixed by separating discovery systems (AGENTS.md:541-549).
3. **`discover_plugins` only runs as model_tools.py side-effect** — fixed by exposing idempotent `discover_plugins(force)` (AGENTS.md:487-489).
4. **Plugin name conflicts with existing tool** — `register_tool` validates uniqueness, raises on collision.
5. **Plugin name resolves to plugins root** — v0.8 PR #5368 plugin name validation.
6. **Project plugin auto-discovery is opt-out** — v0.4 PR #2215 made it opt-in for safety.
7. **Stale plugin bytecode after update** — v0.6 PR #3819 clears `__pycache__` on update.
8. **Plugin LLM provider chain leaks across plugins** — fixed by per-plugin context object.
9. **`pre_tool_call` veto string not interpreted as block** — v0.11 PR #9377 formalized the contract.
10. **Plugin registers tool with `is_async` mismatch** — explicit registration parameter + dispatch validation.
11. **`session:end` hook not firing on interrupted exits** — v0.7 PR #4159 fixed.
12. **Plugin SRI verification** — v0.13 PR #21277 added SRI integrity for dashboard plugin scripts.

## TypeScript API proposal

### Public surface

```typescript
// src/index.ts
export interface Plugin {
  name: string;
  kind: "general" | "memory" | "model-provider";
  version: string;
  register(ctx: PluginContext): void | { shutdown?: () => Promise<void> };
}

export interface PluginContext {
  registerTool(spec: ToolSpec): void;
  registerCommand(spec: SlashCommandSpec): void;
  registerCliCommand(spec: CliCommandSpec): void;
  injectMessage(content: string, role?: "user" | "system"): boolean;
  dispatchTool(name: string, args: Record<string, unknown>): Promise<string>;
  on(hook: HookName, handler: HookHandler): void;
}

export type HookName =
  | "pre_tool_call"
  | "post_tool_call"
  | "pre_llm_call"
  | "post_llm_call"
  | "on_session_start"
  | "on_session_end"
  | "transform_tool_result"
  | "transform_terminal_output"
  | "transform_llm_output";

export class PluginManager {
  register(plugin: Plugin): void;
  discover(opts?: { force?: boolean }): Promise<void>;
  invokeHook<H extends HookName>(hook: H, args: HookArgs<H>): Promise<HookResult<H>[]>;
}

declare module "./agent" {
  interface AgentOptions {
    plugins?: Plugin[];
  }
}
```

### Internal module layout

```
packages/sdk/src/internal/plugins/
├── manager.ts                  # PluginManager
├── context.ts                  # PluginContext implementation
├── manifest.ts                 # plugin.json shape
├── lifecycle-hooks.ts          # Hook registry + invocation
├── pre-tool-veto.ts            # pre_tool_call block-message handling
├── transforms.ts               # transform_* composition
└── discovery.ts                # Filesystem + pip entry points scan
```

### Migration impact on v1.2 users

- **Backward-compatible**: v1.2 has no formal plugin system. v1.3 introduces one. Adoption is opt-in.
- **Breaking signature changes**: None.

## Test strategy

- Hook invocation order matches registration order.
- `pre_tool_call` veto correctly blocks.
- `transform_*` composition works (multiple plugins, sequential application).
- Plugin enable/disable via config + env var.
- Idempotent `discover` doesn't re-import.
- Plugin shutdown runs on dispose.

## Open questions

- **TypeScript AST scanning**: do we autodiscover via filesystem like Hermes? Recommend NO — TypeScript is import-explicit. Users import plugins and pass them to `Agent.create({ plugins: [myPlugin] })`.
- **Dynamic load vs static**: should plugins be loadable at runtime (`PluginManager.load("path/to/plugin")`) or only at agent-create? Recommend agent-create-only for v1.3. Runtime load adds complexity (hot-reload, hook re-registration) for limited gain.
- **CLI subcommand surface in SDK**: not all SDK users have a CLI. `registerCliCommand` may be optional / no-op when no CLI host. Plan accordingly.

## References

- `referencia/hermes-agent/hermes_cli/plugins.py:1-1550`
- AGENTS.md:467-562 — full plugin system documentation
- PR #5295 (v0.8) — removed hardcoded honcho argparse; established the rule
- PR #10626 — `register_command` slash command surface
- PR #10763 — `dispatch_tool`
- PR #9377 — `pre_tool_call` veto
- PR #12972 — `transform_tool_result`
- PR #21235 — `transform_llm_output`
- Theokit ADRs:
  - D24, D25 — `defineTool`, `Agent.builder` interact with plugin registration
