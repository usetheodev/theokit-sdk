# `@agentclientprotocol/sdk` surface inventory — pinned to `^0.22.1`

**Date:** 2026-05-26
**Upstream package:** `@agentclientprotocol/sdk@0.22.1` (Apache-2.0, zero runtime deps, Zed Industries, weekly cadence)
**npm dist.shasum:** `d186adf0992967979d0c9513882d8a42e2a41537`
**Node engine:** >=18 (we constrain to >=22.12 per our `engines.node`)

## Why pinned to `^0.22.1`

Upstream ships weekly. `^0.22.1` in peer deps allows 0.22.x patch + minor. devDeps locked to `~0.22.1` so CI catches breakage early. Bump only when we've validated against the new minor.

## Required types/classes we consume

### Connection / framing

- `AgentSideConnection` — server-side connection class. Constructor `(input: Readable, output: Writable, agentBuilder: (conn: ClientSideConnection) => Agent)`. [REQUIRED]
- `ndJsonStream` — newline-delimited JSON framing helper. Used internally by `AgentSideConnection`. [REQUIRED for tests]
- `ClientSideConnection` — handle passed into agent builder. Exposes `sessionUpdate(sessionId, update)`, `requestPermission(sessionId, req)`. [REQUIRED]

### `Agent` interface (we implement)

- `initialize(params: InitializeRequest): Promise<InitializeResponse>` — [REQUIRED]
- `authenticate(method_id, ...args): Promise<AuthenticateResponse | null>` — [OPTIONAL — stub returns null]
- `newSession(params: NewSessionRequest): Promise<NewSessionResponse>` — [REQUIRED]
- `loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse>` — [OPTIONAL — we implement for resume support]
- `forkSession(params: ForkSessionRequest): Promise<ForkSessionResponse>` — [OPTIONAL — we implement]
- `listSessions(): Promise<ListSessionsResponse>` — [OPTIONAL — we implement]
- `resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse>` — [DEFERRED v0.2]
- `cancel(params: CancelNotification): Promise<void>` — [REQUIRED]
- `prompt(params: PromptRequest): Promise<PromptResponse>` — [REQUIRED]
- `setSessionConfigOption`, `setSessionModel`, `setSessionMode` — [DEFERRED v0.2]

### Request/Response types

- `InitializeRequest`, `InitializeResponse`, `AgentCapabilities`, `PromptCapabilities`, `SessionCapabilities`, `SessionResumeCapabilities`, `SessionListCapabilities`, `SessionForkCapabilities`
- `NewSessionRequest`, `NewSessionResponse`
- `LoadSessionRequest`, `LoadSessionResponse`
- `ForkSessionRequest`, `ForkSessionResponse`
- `ListSessionsRequest`, `ListSessionsResponse`
- `CancelNotification`
- `PromptRequest`, `PromptResponse` — `stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"`
- `AuthenticateResponse`, `AuthMethod`, `AuthMethodAgent`

### Content blocks

- `ContentBlock` discriminated union: `TextContentBlock` | `ImageContentBlock` | `AudioContentBlock` | `ResourceContentBlock` | `ResourceLinkContentBlock` | `EmbeddedResourceContentBlock`
- `TextResourceContents`, `BlobResourceContents`

### Session updates (we emit)

- `SessionUpdate` discriminated union:
  - `agent_message_chunk` — streaming assistant text. **Primary update we emit.**
  - `tool_call` — tool invocation start.
  - `tool_call_update` — tool result/status change.
  - `available_commands_update` — slash commands (deferred v0.2).
  - `model_set` / `mode_set` / `current_mode_update` — (deferred v0.2).
  - `usage_update` — token counts. We emit on terminal.
- `UserMessageChunk`, `AgentMessageChunk` — chunk types
- `ToolCallContent` — tool detail (toolCallId, title, kind_, content, status, locations)
- `ToolCallLocation` — file path + optional line for jump-to-file UI
- `ToolKind` enum: `read | edit | execute | search | think | other`

### Permission flow

- `requestPermission(sessionId, RequestPermissionRequest): Promise<RequestPermissionResponse>` on `ClientSideConnection`
- `RequestPermissionRequest`, `RequestPermissionResponse` — outcome: `selected | cancelled`
- `PermissionOption`, `PermissionOptionKind: allow_once | allow_always | reject_once | reject_always`

### Constants

- `PROTOCOL_VERSION` — current protocol version (we MUST NOT hardcode; read from upstream)

## Verification

```bash
npm view @agentclientprotocol/sdk@0.22.1 dist
# shasum matches above (d186adf0...)
```

## Wire format notes

1. TS surface is camelCase; wire is snake_case. SDK does the conversion. Never manually JSON.stringify.
2. `AgentSideConnection` accepts a generator function `(conn) => Agent` (not an Agent instance directly). This gives us access to the connection inside our handlers.
3. `stopReason` is required in every `PromptResponse`. No "unknown" — we map each terminal SDK state to one of the 5 values.

## Compatibility risk

- Upstream is pre-1.0 — minor bumps may break. Pin devDeps to `~0.22.1` so CI catches it before release.
- Document upgrade procedure: bump devDep → full test suite + Zed dogfood → bump peerDep range → ship.

## Zed environment baseline

- Zed has "External Agents" panel in Settings. Confirmed exists in current stable (verified manually 2026-05-26).
- Agent installation: copy `agent.json` to `~/.config/zed/external_agents/<name>/agent.json`.
- Restart Zed → agent appears in palette → click to start session.
