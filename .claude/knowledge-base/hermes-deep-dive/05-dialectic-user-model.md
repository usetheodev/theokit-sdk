# 05 — Dialectic User Modeling (Honcho integration)

> Hermes exposes a `MemoryProvider` ABC (`agent/memory_provider.py`, 279 LoC)
> with one external reference implementation that uses *dialectic*
> reasoning: `plugins/memory/honcho/` (4817 LoC total). The provider runs an
> "LLM-mediated peer-modeling layer" — Honcho keeps a structured model of
> "who the user is" across sessions, surfaces it via `honcho_profile`,
> `honcho_search`, and `honcho_reasoning` tools, and answers natural-language
> questions about the peer using its own internal LLM (the "dialectic"
> call). Hermes' job is to wrap the SDK and conform to the MemoryProvider
> lifecycle. In TypeScript: `MemoryOptions.userModel: "dialectic"` selects a
> dialectic-backed memory provider; we ship a Honcho adapter (peer dep) plus
> the contract for other dialectic providers.

## What problem this domain solves

"Memory" in agent frameworks usually means two things mashed together: (1) *episodic* — "what happened last Tuesday in this conversation"; (2) *semantic / model-of-user* — "this user prefers TypeScript, hates verbose explanations, works in fintech." Hermes' built-in memory tool handles (1); for (2) it offloads to an *external memory provider*.

A naïve user-model is just a list of facts: "User likes TypeScript." This works until the facts contradict each other (Wednesday: "I'm switching to Rust"). The user model needs to evolve — old facts get invalidated, new ones get integrated, the model gets refined over time.

Honcho's design pattern is **dialectic Q&A**: instead of querying a static fact list, you ask Honcho a question ("does the user prefer TypeScript or Rust?") and Honcho's internal LLM reasons over its accumulated peer cards, conversation excerpts, and prior conclusions to produce a synthesized answer. The dialectic happens *inside Honcho*, not in the calling agent. The calling agent gets a clean natural-language answer.

The other distinguishing trait: **multi-peer awareness**. Honcho models not just the user but the "ai" peer (the agent's own behavior patterns) and any other named peers in the workspace. The same agent serving multiple users in a gateway keeps each peer's model isolated by `peer_id`.

Hermes' job is *not* to invent a user-modeling system. It is to expose Honcho (and other providers like Hindsight, Mem0, Supermemory, ByteRover, RetainDB, OpenViking — all listed in AGENTS.md:497) behind a uniform `MemoryProvider` ABC, with consistent lifecycle hooks, consistent tool registration, and per-profile credential scoping. Plugin authors implement the ABC; users pick one via `memory.provider` config.

## Hermes file layout

| File | LoC | Role |
|---|---|---|
| `agent/memory_provider.py` | 279 | The `MemoryProvider` ABC. All providers implement this. |
| `agent/memory_manager.py` | 555 | The orchestrator. Loads/activates one external provider. Enforces "only one external provider at a time" invariant. |
| `plugins/memory/honcho/__init__.py` | 1328 | `HonchoMemoryProvider` — the ABC implementation. |
| `plugins/memory/honcho/client.py` | 783 | Honcho SDK wrapper — peer/workspace/session lifecycle. |
| `plugins/memory/honcho/session.py` | 1255 | Per-session state machine: dialectic cadence, empty-streak tracking, pre-warm. |
| `plugins/memory/honcho/cli.py` | 1451 | `hermes honcho …` subcommands (setup, status, peer, etc.). |
| `tests/honcho_plugin/` | — | Honcho-specific tests. |

Other in-tree providers (per AGENTS.md:491-500): `plugins/memory/mem0/`, `plugins/memory/supermemory/`, `plugins/memory/byterover/`, `plugins/memory/hindsight/`, `plugins/memory/holographic/`, `plugins/memory/openviking/`, `plugins/memory/retaindb/`. The set is **closed by policy** as of May 2026 (AGENTS.md:515-525): new memory backends must ship as standalone plugin repos.

Confirmed via `wc -l` on Honcho dir totalling **4817 LoC**.

## Canonical entry point

The ABC is the contract. Providers register themselves; the orchestrator picks one based on config.

```python
# agent/memory_provider.py:42
class MemoryProvider(ABC):
    """Abstract base class for memory providers."""

    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    def is_available(self) -> bool: ...

    @abstractmethod
    def initialize(self, session_id: str, **kwargs) -> None: ...

    def system_prompt_block(self) -> str: ...
    def prefetch(self, query: str, *, session_id: str = "") -> str: ...
    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "") -> None: ...

    @abstractmethod
    def get_tool_schemas(self) -> List[Dict[str, Any]]: ...

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str: ...
    def shutdown(self) -> None: ...

    # Optional lifecycle hooks:
    def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None: ...
    def on_session_end(self, messages: List[Dict[str, Any]]) -> None: ...
    def on_session_switch(self, new_session_id: str, *, parent_session_id: str = "", reset: bool = False, **kwargs) -> None: ...
    def on_pre_compress(self, messages: List[Dict[str, Any]]) -> str: ...
    def on_delegation(self, task: str, result: str, *, child_session_id: str = "", **kwargs) -> None: ...
    def on_memory_write(self, action: str, target: str, content: str, metadata: Optional[Dict[str, Any]] = None) -> None: ...
    def get_config_schema(self) -> List[Dict[str, Any]]: ...
    def save_config(self, values: Dict[str, Any], hermes_home: str) -> None: ...
```

## Happy path: user opens a session, Honcho recalls relevant context, agent reasons with it

```
[Agent startup]
  └─ MemoryManager loads provider from memory.provider config key
       └─ agent/memory_manager.py
  └─ Resolves to "honcho" → instantiates plugins.memory.honcho.HonchoMemoryProvider()
  └─ provider.is_available() → reads HONCHO_API_KEY env or honcho.json config
       └─ Returns True iff key present, server reachable
  └─ provider.initialize(
         session_id="ses_abc123",
         hermes_home="/home/x/.hermes",
         platform="cli",
         agent_context="primary",       # NOT "subagent" / "cron" / "flush"
         agent_identity="coder",         # profile name
         user_id="user_42",              # platform user id
     )
       └─ plugins/memory/honcho/__init__.py:HonchoMemoryProvider.initialize
       └─ Resolves Honcho workspace from agent_workspace (defaults to "hermes")
       └─ Creates / fetches peer (user_42) and workspace
       └─ Spawns daemon thread "honcho-prewarm-dialectic" that fires a first dialectic query
            └─ Result cached for next prefetch() call

[Agent system prompt assembly]
  └─ provider.system_prompt_block()
       └─ Returns static text:
          "Honcho (ai-native user modeling) is active. Use honcho_profile to read peer cards,
           honcho_search for semantic recall, honcho_reasoning for synthesized Q&A.
           Workspace: hermes. Peer: user_42."

[Agent tool registration]
  └─ provider.get_tool_schemas() returns 4 tool defs:
       - honcho_profile  (read/write peer card)
       - honcho_search   (semantic search — no LLM synthesis)
       - honcho_reasoning (dialectic Q&A — Honcho's LLM synthesizes answer)
       - honcho_conclude (write a structured conclusion about the peer)

[User sends message: "what's the latest on the auth refactor?"]
  └─ provider.on_turn_start(turn=5, message="what's the latest on the auth refactor?")
       └─ Increments turn counter
       └─ May queue a background dialectic call for prefetch

[Before LLM call: provider.prefetch(query=user_message)]
  └─ plugins/memory/honcho/__init__.py:HonchoMemoryProvider.prefetch
  └─ Phase 1: cheap recall — peer card + cached dialectic supplement
       └─ representation = client.peer_card(peer_id=user_42)
            └─ Returns: "User is a senior eng at fintech, prefers TypeScript, hates verbose explanations …"
       └─ if cached dialectic non-empty:
            supplement = cached_dialectic
       else:
            supplement = ""
  └─ Phase 2: if dialectic cadence triggered (every 2 turns by default), fire fresh dialectic
       └─ self._dialectic_cadence == 2 and self._turn_count - self._last_dialectic_turn >= 2:
            r = self._run_dialectic_depth(query="what's the latest on the auth refactor?")
                 └─ Calls Honcho's /chat endpoint internally
                 └─ Honcho's LLM reasons over the peer's conversation history
                 └─ Returns "Last week the user was reviewing PR #12345 for the auth refactor, …"
            if r is non-empty:
                self._cached_dialectic = r
                self._last_dialectic_turn = self._turn_count
                self._dialectic_empty_streak = 0
            else:
                self._dialectic_empty_streak += 1
                # If empty 3+ times in a row → skip dialectic until next session restart
  └─ Phase 3: format and return for system-prompt injection
       └─ Returns:
          "## Honcho recall (user_42)

           Peer card:
           - Senior engineer at fintech startup
           - Prefers TypeScript
           - …

           Dialectic recall (depth=1):
           Last week the user was reviewing PR #12345 for the auth refactor.
           They were specifically concerned about token rotation under load."

[Provider's prefetch text gets injected as part of the system prompt for this turn]
  └─ The agent's LLM call now has both the user's question AND the relevant peer context.
  └─ Agent generates a contextually-aware reply.

[After agent returns, before next turn]
  └─ provider.sync_turn(
         user_content="what's the latest on the auth refactor?",
         assistant_content="<the agent's reply>",
     )
       └─ Queues a background write to Honcho — Honcho ingests both messages,
          updates the peer card and dialectic state asynchronously.
       └─ Non-blocking — returns immediately.

[Session ends — /reset, /new, or CLI exit]
  └─ provider.on_session_end(messages=full_history)
       └─ Honcho's end-of-session extraction pass — pulls structured facts.

[Session_id switches mid-process (/resume, /branch, /reset)]
  └─ provider.on_session_switch(
         new_session_id="ses_xyz789",
         parent_session_id="ses_abc123",
         reset=True,  # True for /reset/new, False for /resume/branch
     )
       └─ Provider updates internal _session_id, clears turn buffers if reset=True.

[Shutdown]
  └─ provider.shutdown()
       └─ Flushes any pending writes.
       └─ Closes HTTP connections.
```

## Architectural decisions

### AD-1: ABC + lifecycle hooks contract, not duck typing

- **Decision**: `MemoryProvider` is a Python ABC with explicitly-typed abstract methods. Providers must implement `name`, `is_available`, `initialize`, `get_tool_schemas`. Everything else has a default (mostly no-op or empty-string return).

- **Evidence**: `agent/memory_provider.py:42-279` — entire ABC.

- **Rationale**: The plugin surface is *deliberately* well-typed despite Python's duck-typing tradition. Plugin authors get IDE assistance, type-check feedback, and clear contracts. Per AGENTS.md:497-507, this contract is mature — eight in-tree providers all implement it.

- **TypeScript translation**: TypeScript interface `MemoryProvider`. Required vs optional methods enforced by `?:` markers. Same shape as the ABC.

### AD-2: One external provider at a time

- **Decision**: MemoryManager enforces a one-external-provider limit. The built-in memory (file-based scratchpad) always runs; one external provider (Honcho OR Hindsight OR Mem0 etc.) layers on top.

- **Evidence**: `agent/memory_provider.py:4-7`:

  ```
  Memory providers give the agent persistent recall across sessions.
  The MemoryManager enforces a one-external-provider limit to prevent
  tool schema bloat and conflicting memory backends.
  ```

- **Rationale**: Tool schema bloat. Each external provider exposes 3-5 tools. Running all of them simultaneously gives the model 30 memory tools to choose from — paralysis. Plus the providers' models of the same user would conflict.

- **Alternative rejected**: Multiple providers running in parallel with namespace prefixes (`honcho_*`, `hindsight_*`). The schema bloat argument won.

- **TypeScript translation**: `MemoryOptions.userModel: "dialectic" | "vector" | "graph" | …` selects one. SDK rejects misconfiguration at `Agent.create` with a clear error.

### AD-3: Three lifecycle phases — initialize, per-turn, end-of-session

- **Decision**: Provider lifecycle splits into (1) `initialize(session_id, **kwargs)` once at startup, (2) per-turn calls (`on_turn_start` → `prefetch` → LLM call → `sync_turn` → `queue_prefetch`), (3) `on_session_end` / `on_session_switch` / `shutdown` at boundaries.

- **Evidence**: `agent/memory_provider.py:15-30` lists the lifecycle calls.

- **Rationale**: Clean separation lets providers buffer work optimally. `prefetch` is on the synchronous critical path before the LLM call — must be fast (read cache). `sync_turn` happens after — can be queued. `queue_prefetch` runs after to warm cache for *next* turn. End-of-session extraction is heavy and runs only on actual boundaries.

- **TypeScript translation**: Same method signatures. Async returns where blocking is unacceptable (`sync_turn` is fire-and-forget).

### AD-4: `prefetch` returns formatted text for system-prompt injection, not raw data

- **Decision**: `prefetch(query)` returns a string. The agent injects it verbatim into the system prompt for the upcoming turn.

- **Evidence**: `agent/memory_provider.py:92-104`:

  ```python
  def prefetch(self, query: str, *, session_id: str = "") -> str:
      """Recall relevant context for the upcoming turn.

      Called before each API call. Return formatted text to inject as
      context, or empty string if nothing relevant. Implementations
      should be fast — use background threads for the actual recall
      and return cached results here.
      """
  ```

- **Rationale**: Providers know their own data shape; the agent doesn't. Returning text means the provider controls formatting (markdown headers, bullet points, citations) and the agent just concatenates.

- **TypeScript translation**: Same — provider returns formatted text. `Memory.recallForTurn(query, sessionId): Promise<string>`. Empty string means "nothing relevant", agent skips injection.

### AD-5: Dialectic cadence — fire dialectic every N turns, not every turn

- **Decision**: Honcho's dialectic call is expensive (full LLM round-trip on the provider side). It fires every `dialectic_cadence` turns, not every turn. Default cadence is 2; the wizard writes 2 explicitly for new configs (backward compat: unset cadence → 1).

- **Evidence**: `plugins/memory/honcho/__init__.py:214-216`:

  ```python
  self._dialectic_cadence = 1  # backwards-compat fallback; wizard writes 2 on new configs
  self._dialectic_depth = 1   # how many .chat() calls per dialectic cycle (1-3)
  self._dialectic_depth_levels: list[str] | None = None  # per-pass reasoning levels
  ```

- **Rationale**: Dialectic costs token + latency. Most turns don't need fresh dialectic — the cached result from 2 turns ago is still relevant. Cadence + cache is cheap.

- **TypeScript translation**: `MemoryOptions.dialectic.cadence?: number` (default 2). The adapter caches the most recent result and reuses it for `cadence-1` turns.

### AD-6: Empty-streak detection auto-pauses dialectic

- **Decision**: If `dialectic` returns empty 3 turns in a row, Honcho's provider stops calling it for the rest of the session (`_dialectic_empty_streak`).

- **Evidence**: `plugins/memory/honcho/__init__.py:225`:

  ```python
  self._dialectic_empty_streak: int = 0           # consecutive empty returns
  ```

  And the streak increment at multiple points (e.g. `:423`, `:434`, `:629`, `:640`).

- **Rationale**: A fresh peer has no conversation history to reason over. Honcho returns empty. Without an auto-pause, every turn pays the dialectic call cost for nothing. The streak gates additional calls until the next session restart.

- **TypeScript translation**: Same pattern. Mirror the empty-streak counter exactly.

### AD-7: Pre-warm thread on initialize

- **Decision**: At `initialize` time, spawn a daemon thread that fires the first dialectic call against a seed query so the result is cached and ready for the first user turn.

- **Evidence**: `plugins/memory/honcho/__init__.py:418-437`:

  ```python
  def _prewarm_dialectic() -> None:
      try:
          r = self._run_dialectic_depth(_prewarm_query)
      except Exception as exc:
          logger.debug("Honcho dialectic prewarm failed: %s", exc)
          self._dialectic_empty_streak += 1
          return
      …

  threading.Thread(
      target=_prewarm_dialectic, daemon=True, name="honcho-prewarm-dialectic"
  ).start()
  ```

- **Rationale**: The first user turn is the slowest because there's no cache. Pre-warming hides the dialectic latency behind agent startup.

- **TypeScript translation**: `Promise` fired and stored. The first `prefetch` await this promise (with a bounded timeout) before falling back to the no-cache path.

### AD-8: Agent context filtering — skip writes for subagents / cron / flush

- **Decision**: `kwargs` to `initialize` includes `agent_context: "primary" | "subagent" | "cron" | "flush"`. Providers should skip writes for non-primary contexts (cron system prompts would corrupt user representations).

- **Evidence**: `agent/memory_provider.py:74-77`:

  ```
  agent_context (str): "primary", "subagent", "cron", or "flush".
    Providers should skip writes for non-primary contexts (cron system
    prompts would corrupt user representations).
  ```

- **Rationale**: A cron-spawned agent's "user message" is the cron's data-collection script output, not actual user input. Writing it to the user model would pollute the peer card with random JSON dumps. Subagents and the background-review flush context have the same issue.

- **TypeScript translation**: `MemoryOptions.agentContext: "primary" | "subagent" | "cron" | "flush"` passed to the provider. Provider's contract: skip writes for non-primary.

### AD-9: Per-profile + per-user scoping

- **Decision**: Honcho config lives in `$HERMES_HOME/honcho.json` (profile-scoped). `peer_id` is the platform's user_id (gateway sessions) or a profile-specific default.

- **Evidence**: `plugins/memory/honcho/__init__.py:10-13` (module docstring):

  ```
  Config: Uses the existing Honcho config chain:
    1. $HERMES_HOME/honcho.json (profile-scoped)
    2. ~/.honcho/config.json (legacy global)
    3. Environment variables
  ```

- **Rationale**: Two scoping axes: (a) per profile (different Hermes profiles want different Honcho workspaces — work vs personal); (b) per user (the gateway serves multiple users on Telegram, each gets their own peer model).

- **TypeScript translation**: `MemoryOptions.dialectic.config: { workspace?, peerId?, apiKey? }`. Workspace defaults to "theokit". peerId defaults to the user_id from `Agent.create({ userId })` when present.

### AD-10: Tool schemas exposed via `get_tool_schemas`, dispatched via `handle_tool_call`

- **Decision**: A provider's tools are registered through `get_tool_schemas` (returns OpenAI function call format) and dispatched through `handle_tool_call(name, args)`. The agent loop sees them as native tools.

- **Evidence**: `agent/memory_provider.py:121-137`:

  ```python
  @abstractmethod
  def get_tool_schemas(self) -> List[Dict[str, Any]]:
      """Return tool schemas this provider exposes.
      …
      Return empty list if this provider has no tools (context-only).
      """

  def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
      """Handle a tool call for one of this provider's tools.
      Must return a JSON string (the tool result).
      """
  ```

  Honcho exposes 4 tools: `honcho_profile`, `honcho_search`, `honcho_reasoning`, `honcho_conclude` (per `plugins/memory/honcho/__init__.py:36-100`).

- **Rationale**: Tools are the LLM-visible surface. The provider decides which operations are explicit (LLM-callable tools) vs implicit (auto-injected via `prefetch`). Honcho's split: card-reading is implicit (prefetch always includes it), explicit search/reasoning is via tools.

- **TypeScript translation**: `MemoryProvider.getToolSchemas(): ToolSchema[]` + `handleToolCall(name, args): Promise<string>`. Same shape.

### AD-11: `on_pre_compress` returns provider-specific summary to preserve insights

- **Decision**: Before context compression, `on_pre_compress(messages)` returns a string that gets included in the compressor's summary prompt. Provider-extracted insights survive the compression.

- **Evidence**: `agent/memory_provider.py:202-212`:

  ```python
  def on_pre_compress(self, messages: List[Dict[str, Any]]) -> str:
      """Called before context compression discards old messages.

      Use to extract insights from messages about to be compressed.
      messages is the list that will be summarized/discarded.

      Return text to include in the compression summary prompt so the
      compressor preserves provider-extracted insights.
      """
  ```

- **Rationale**: When context gets compressed, the dialectic recall from those turns goes with it. Without this hook, the user model would lose continuity. The hook lets the provider extract a one-paragraph "what mattered in these turns" that the compressor preserves.

- **TypeScript translation**: Same method. Compression flow calls it.

### AD-12: `on_memory_write` mirrors built-in memory writes

- **Decision**: When the agent's built-in memory tool writes a fact, providers get notified via `on_memory_write(action, target, content, metadata)` so they can mirror the write into their own backend.

- **Evidence**: `agent/memory_provider.py:262-279`:

  ```python
  def on_memory_write(
      self,
      action: str,           # 'add' | 'replace' | 'remove'
      target: str,           # 'memory' | 'user'
      content: str,
      metadata: Optional[Dict[str, Any]] = None,
  ) -> None:
      """Called when the built-in memory tool writes an entry."""
  ```

- **Rationale**: The agent has a *built-in* file-based memory tool (`memory.add(content)`). When the agent uses it, the user expects Honcho's peer model to update too — otherwise the two memory stores diverge. The hook synchronizes them.

- **TypeScript translation**: Same shape. `MemoryProvider.onMemoryWrite(action, target, content, metadata)`.

## Data structures

### Persisted

**Path**: `~/.hermes/honcho.json` (profile-scoped). Schema is provider-specific. Honcho stores:

```json
{
  "apiKey": "honcho_…",                  // also in .env as HONCHO_API_KEY
  "workspace": "hermes",
  "baseUrl": "https://app.honcho.dev",   // optional, defaults to public Honcho
  "peerId": null,                         // optional; usually derived from user_id
  "dialecticCadence": 2,
  "dialecticDepth": 1,
  "observationsEnabled": true,
  "reasoning_level": "low"
}
```

Plus on-disk caches under `~/.hermes/honcho/` for offline mode.

Honcho itself maintains state on the Honcho server (peer cards, workspace state, dialectic conclusions). The local `honcho.json` is only the config + cache.

### In-memory

```python
# plugins/memory/honcho/__init__.py:194-225 (snippets)
class HonchoMemoryProvider(MemoryProvider):
    _client: Optional[HonchoClient]            # SDK wrapper from client.py
    _workspace_id: Optional[str]
    _peer_id: Optional[str]
    _session_id: Optional[str]
    _turn_count: int
    _dialectic_cadence: int                    # default 1, wizard writes 2
    _dialectic_depth: int                      # 1-3
    _dialectic_depth_levels: list[str] | None  # per-pass reasoning levels
    _cached_dialectic: Optional[str]
    _last_dialectic_turn: int                  # -999 = never
    _dialectic_empty_streak: int               # auto-pause threshold
    _system_prompt_block: str
```

### Concurrency model

- **Daemon threads** for pre-warm and async sync.
- **`asyncio` not used** by Honcho provider — pure synchronous Python with worker threads for non-blocking I/O.
- **Locks**: provider holds its own `_lock: threading.Lock` for the dialectic cache + streak counter.
- **HTTP**: Honcho SDK uses `requests` synchronously; the provider wraps every call in a worker thread for non-blocking `sync_turn`.

## Failure modes Hermes already fixed

### 1. Honcho recall in cached system prefix breaks prompt cache (#1201)

- **What can go wrong**: Dialectic output changes turn-to-turn. If injected into the cached system prompt prefix, every turn invalidates the cache.
- **How Hermes handles it**: Per RELEASE_v0.3.0.md PR #1201, Honcho recall is kept *out* of the cached system prefix. The provider returns it as a separate block injected as part of the *user* message context, not the system prompt prefix.

### 2. Honcho session routing not user-isolated in gateway groups (#1500)

- **What can go wrong**: A group chat with two users both writing to "user_42"'s peer model. Cross-pollination.
- **How Hermes handles it**: PR #1500 (v0.3) — isolate Honcho session routing for multi-user gateway. Each user_id gets its own peer.

### 3. Honcho config writes to wrong profile

- **What can go wrong**: Pre-#4037 (v0.7), Honcho config wrote to `~/.honcho/config.json` regardless of active profile. Two profiles overwrote each other.
- **How Hermes handles it**: `$HERMES_HOME/honcho.json` is the primary path. Per-profile isolation by `_apply_profile_override` setting `HERMES_HOME` before imports.

### 4. Empty dialectic returns burn cost forever

- **What can go wrong**: Fresh peer with no conversation history. Every dialectic call returns empty. Without an auto-pause, every turn pays for nothing.
- **How Hermes handles it**: `_dialectic_empty_streak` counter; after 3 consecutive empties, skip until session restart.

### 5. Pre-warm thread runs before peer exists

- **What can go wrong**: Pre-warm fires on init, but `initialize` hasn't fully created the peer yet. Race.
- **How Hermes handles it**: Pre-warm is fire-and-forget with try/except. On failure, `_dialectic_empty_streak += 1` and continue. Loop self-heals on next prefetch.

### 6. Memory provider tools not routed through sequential execution path (PR #4803)

- **What can go wrong**: Memory provider tool calls were going through the concurrent execution path with other tools. Race conditions where the provider's `sync_turn` lagged behind the tool's `add`.
- **How Hermes handles it**: PR #4803 (v0.7) — memory provider tools routed sequentially.

### 7. Honcho-only auto-enable broke setup wizard (#243)

- **What can go wrong**: PR #243 (v0.2) — Honcho auto-enabled if HONCHO_API_KEY was present, but the wizard skipped configuration prompts users still needed.
- **How Hermes handles it**: Fix: explicit "honcho is detected, do you want to enable?" prompt.

### 8. PII redaction config missing yaml import (#1701)

- **What can go wrong**: PR #1701 — `privacy.redact_pii` config never read because `yaml` import was missing.
- **How Hermes handles it**: Fix: import yaml at module load.

### 9. Multi-process Honcho session_id rotation desync

- **What can go wrong**: Two Hermes processes rotate session_ids at slightly different times. Honcho gets out-of-order updates for the same peer.
- **How Hermes handles it**: `on_session_switch` hook (`memory_provider.py:163-200`) called on `/resume`, `/branch`, `/reset`, `/new`, compression — keeps provider state in sync.

### 10. Closed in-tree provider set (Teknium policy, May 2026)

- **What can go wrong**: Every PR adding a new provider grew the in-tree footprint and required upstream maintenance. Memory backends multiplied — Honcho, Hindsight, Mem0, Supermemory, ByteRover, Holographic, OpenViking, RetainDB — and the README's "providers" table got unwieldy.
- **How Hermes handles it**: AGENTS.md:515-525 declares the set closed. New backends ship as standalone plugin repos. Existing in-tree providers stay; bug fixes welcome.

## TypeScript API proposal

### Public surface

```typescript
// src/index.ts
export type { MemoryProvider, MemoryProviderContext, MemoryProviderToolSchema } from "./memory/provider";

// src/memory/types.ts
export interface MemoryProvider {
  /** Short identifier (e.g. "honcho", "hindsight"). */
  readonly name: string;

  /** Quick config check — no network. */
  isAvailable(): boolean;

  /** Called once at agent init. Spawn pre-warm threads here. */
  initialize(sessionId: string, context: MemoryProviderContext): Promise<void>;

  /** Static text for the system prompt. Return "" to skip. */
  systemPromptBlock(): string;

  /** Synchronous recall for the upcoming turn (read cache). */
  prefetch(query: string, opts?: { sessionId?: string }): Promise<string>;

  /** Async write queue for the completed turn. */
  syncTurn(userContent: string, assistantContent: string, opts?: { sessionId?: string }): Promise<void>;

  /** Tools to expose to the model. */
  getToolSchemas(): MemoryProviderToolSchema[];

  /** Dispatch a tool call. */
  handleToolCall(toolName: string, args: Record<string, unknown>, opts?: { sessionId?: string }): Promise<string>;

  /** Clean shutdown — flush queues. */
  shutdown(): Promise<void>;

  // ---- Optional hooks (override to opt in) -----------------------------
  onTurnStart?(turnNumber: number, message: string, opts?: { remainingTokens?: number; model?: string; platform?: string; toolCount?: number }): void;
  onSessionEnd?(messages: ChatMessage[]): Promise<void>;
  onSessionSwitch?(newSessionId: string, opts: { parentSessionId?: string; reset?: boolean }): Promise<void>;
  onPreCompress?(messages: ChatMessage[]): Promise<string>;
  onDelegation?(task: string, result: string, opts: { childSessionId?: string }): void;
  onMemoryWrite?(action: "add" | "replace" | "remove", target: "memory" | "user", content: string, metadata?: Record<string, unknown>): void;

  // ---- Setup wizard support -------------------------------------------
  getConfigSchema?(): MemoryProviderConfigField[];
  saveConfig?(values: Record<string, unknown>, theokitHome: string): Promise<void>;
}

export interface MemoryProviderContext {
  theokitHome: string;
  platform: string;
  agentContext: "primary" | "subagent" | "cron" | "flush";
  agentIdentity?: string;
  agentWorkspace?: string;
  parentSessionId?: string;
  userId?: string;
}

// Memory namespace surface
declare module "./memory" {
  interface Memory {
    /** Register a provider (called by plugin discovery). */
    registerProvider(provider: MemoryProvider): void;
    /** Activate one provider — disables built-in if external selected. */
    activateProvider(name: string): Promise<void>;
  }
}

// Agent option
declare module "./agent" {
  interface AgentOptions {
    memory?: {
      provider?: "builtin" | string;          // "honcho" | "hindsight" | …
      userModel?: "dialectic" | "vector" | "graph" | "none";
      // Per-provider config goes under provider-specific subkeys
      honcho?: HonchoConfig;
      hindsight?: HindsightConfig;
    };
  }
}

export interface HonchoConfig {
  apiKey?: string;                  // env var HONCHO_API_KEY also accepted
  baseUrl?: string;                  // default https://app.honcho.dev
  workspace?: string;                // default "theokit"
  peerId?: string;                   // default: derived from agent userId
  dialecticCadence?: number;         // default 2
  dialecticDepth?: 1 | 2 | 3;        // default 1
  reasoningLevel?: "minimal" | "low" | "medium" | "high" | "max";
}
```

### Internal module layout

```
packages/sdk/src/internal/memory/
├── provider.ts                     # MemoryProvider interface (verbatim from ABC)
├── manager.ts                      # MemoryManager — load, activate, enforce one-external rule
├── types.ts                        # Public types
├── providers/
│   ├── builtin/
│   │   └── index.ts                # Default file-based memory (always active)
│   └── honcho/                     # @usetheo/sdk-memory-honcho — separate peer dep package
│       ├── index.ts                # HonchoMemoryProvider implementation
│       ├── client.ts               # Honcho SDK wrapper
│       ├── session.ts              # Per-session state
│       └── prompts.ts              # Tool schemas (profile, search, reasoning, conclude)
└── registry.ts                     # Provider registry (one-at-a-time enforcement)
```

### Persistence layout

```
~/.theokit/
├── memory/                         # Built-in scratchpad
│   ├── memory.md
│   └── user.md
├── honcho.json                     # Honcho profile-scoped config
└── honcho/                         # Honcho local cache
    └── <peer_id>/
        └── …
```

### Optional peer dependencies

| Dep | Why | When required |
|---|---|---|
| `@usetheo/sdk-memory-honcho` | Honcho provider (separate package) | Only if user opts into `memory.provider: "honcho"` |
| `honcho-sdk` or similar | Honcho's official SDK | Pulled in by `@usetheo/sdk-memory-honcho` |

Memory providers ship as **separate npm packages** that depend on `@usetheo/sdk` and implement `MemoryProvider`. The SDK itself does not bundle them — mirroring Hermes' "closed in-tree set, plugins via standalone repos" policy (AGENTS.md:515-525).

### Migration impact on v1.2 users

- **Backward-compatible**: Yes. Existing `Memory` API extended with `registerProvider`/`activateProvider`. Users who don't activate an external provider keep the built-in.
- **Breaking signature changes**: None.
- **Migration path**: Users opt in by `npm i @usetheo/sdk-memory-honcho` + `Agent.create({ memory: { provider: "honcho", honcho: { apiKey } } })`.

## Test strategy

Hermes tests to port:

- `tests/honcho_plugin/` — Honcho-specific unit + integration tests
- `tests/test_honcho_client_config.py` — config resolution chain

**Unit tests**:
- `MemoryProvider` ABC contract: stub implementation, assert all required methods raise without override.
- Provider registry: registering two external providers fails.
- Dialectic cadence: turn 1 fires; turn 2 reads cache; turn 3 fires; turn 4 reads cache (with cadence=2).
- Empty-streak: 3 consecutive empties auto-pauses; restart re-enables.

**Integration tests**:
- Real Honcho server (sandbox API key): full happy-path flow.
- Session_switch: assert peer state preserved across `/resume`, reset across `/reset`.

**Real-LLM tests**:
- Multi-turn conversation referencing a peer fact, assert dialectic surfaces it correctly.

**Examples to ship**:
- `examples/dialectic-honcho/` — minimal Honcho integration showing peer card + dialectic Q&A.
- `examples/dialectic-multi-user/` — gateway-style multi-user scenario.

## Open questions

- **Provider package naming**: `@usetheo/sdk-memory-honcho` vs `@usetheo/memory-honcho`? Recommend keeping `sdk-` prefix.
- **Should Hindsight, Mem0, ByteRover ship as official packages or stay community?** Hermes ships all 8 in-tree. Our SDK is greenfield — recommend community-first: only Honcho gets an official adapter package, others are community-maintained.
- **`agent_context` mapping**: Hermes has 4 contexts (primary/subagent/cron/flush). Our SDK has fewer modes. Recommend collapsing: `primary` (default), `non-primary` (everything else, providers skip writes).
- **HTTP vs SDK**: do we wrap Honcho's HTTP API directly or pull in their official SDK? SDK is cleaner but adds a dep. Recommend their official Node SDK if it exists.
- **Pre-warm thread vs Promise**: Node doesn't have threads. The equivalent is a fire-and-forget `Promise` that the first `prefetch` awaits. Cost: an `await` that may be unbounded if Honcho is slow. Mitigation: timeout (e.g. 500ms) — fall back to no pre-warm.

## References

- `referencia/hermes-agent/agent/memory_provider.py:1-279`
- `referencia/hermes-agent/agent/memory_manager.py:1-555`
- `referencia/hermes-agent/plugins/memory/honcho/__init__.py:1-1328`
- `referencia/hermes-agent/plugins/memory/honcho/client.py:1-783`
- `referencia/hermes-agent/AGENTS.md:467-562` — Plugin system architecture (overall)
- `referencia/hermes-agent/AGENTS.md:491-525` — Memory provider plugins + closed-set policy
- RELEASE_v0.2.0.md PR #38 — initial Honcho integration by @erosika
- RELEASE_v0.7.0.md PR #4623, #4355 — MemoryProvider ABC + Honcho full parity
- RELEASE_v0.8.0.md PR #4803 — sequential memory tool execution
- RELEASE_v0.3.0.md PR #1201, #1500 — cache prefix + multi-user isolation
- [Honcho documentation](https://docs.honcho.dev) — external
- Theokit ADRs:
  - D9 — Memory namespace defaults
  - D11 — Embedding adapters shipped (separate concern from dialectic)
  - D43 — LanceDB backend — alternative vector path
  - D46 — Cross-agent shared memory deferred to v1.3
