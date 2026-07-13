# Changelog

## 2.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@3.0.0

## 1.0.1

### Patch Changes

- 98ac0d0: Fix a live security defect: the ACP `pre_tool_call` permission veto was never enforced (#68). `installPermissionPlugin` tried to register its veto hook via `pluginManager.register(...)`, but `PluginManager` exposed no `register()` method — only a single-shot `initialize()` that throws when called twice. The call fell through to `void mgr.initialize([plugin])`, whose "called twice" rejection was swallowed, so the permission hook was never aggregated and guarded tools ran **without** the permission check even under `permissionMode: "deny"`/`"ask"`.

  `PluginManager` now exposes `register(plugin)` — a post-init, `general`-only registration that REPLACES a same-named plugin's hooks (idempotent for the per-prompt ACP re-install) instead of appending duplicates. Additionally, `installPermissionPlugin` is now **fail-closed**: when the runtime has no plugin manager (e.g. a CloudAgent) and the mode is `deny`/`ask`, it throws a `ConfigurationError` (`code: "permission_enforcement_unavailable"`) and the ACP prompt is refused — rather than letting tools run ungated while the operator believes they are gated. It is also now `async` and awaits registration, so the veto hook is guaranteed aggregated before the first tool dispatch (no fire-and-forget window).

## 1.0.0

### Patch Changes

- Updated dependencies [b9f30a6]
  - @theokit/sdk@2.0.0

## 2.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.3.0

## 1.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.2.0

## 0.1.0

### Minor Changes

- Initial release: ACP server adapter for `@theokit/sdk`. ADRs D349-D360.

  **Added:**

  - **`serveAcp({ agent })`** — block on stdio JSON-RPC ACP server until disconnect.
  - **`AgentFactory = (sessionId) => Promise<SDKAgent>`** — per-session isolation (D351).
  - **Session lifecycle handlers** — `initialize`, `newSession`, `loadSession`, `listSessions`, `cancel`, `prompt`.
  - **Stream translator** — maps `SDKMessage` → ACP `SessionUpdate` with exhaustive switch + `never` check (D353).
  - **Tool permission flow** — `pre_tool_call` veto bridges ACP `requestPermission`; modes `ask`/`auto`/`deny` (D355).
  - **Per-session AbortController** — `cancel` fires session abort; passes through to `agent.send` signal (D354).
  - **Prompt size cap** — 2 MiB default; `PromptTooLargeError` exported (D360).
  - **CJS interop** — bin shim and CLI use `mod.default ?? mod` fallback (EC-4).
  - **Cleanup on stdin close** — every active session disposed before `serveAcp` resolves (EC-1).
  - **Permission timeout** — `permissionTimeoutMs` default 60_000; prevents prompt-hang on unresponsive client (EC-2).
  - **Helpful `load_session` error** — "session not found" message hints at `conversationStorage` for serverless (EC-6).
  - **CWD validation** — absolute path resolved before factory invocation (EC-5).
  - **Bin shim** — `npx theokit-acp` works without installing `@theokit/cli`.
  - **Registry manifest** — `packages/acp/registry/agent.json` for the ACP marketplace.

  **Deferred to v0.2:**

  - `unstable_forkSession` — current SDK fork is a one-shot ephemeral sub-run; proper session split needs `Agent.create()` with parent inheritance (D350).
  - `authenticate` — token/OAuth handshake (D350).
  - JSON-file session persistence (D356).
  - ACP client (calling external ACP agents from inside the SDK).
