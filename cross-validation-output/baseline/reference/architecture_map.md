# deepagents Architecture Map

## Overview
Python AI agent framework by LangChain. Multi-package monorepo: libs/deepagents (core),
libs/code (CLI), libs/acp (Agent Communication Protocol), libs/evals, libs/cli, libs/talon,
libs/partners. 112,411 LoC total, 340 test files. Built on LangGraph + LangChain.

## Layering

```
Public API (create_deep_agent, DeepAgentState, middleware classes)
    |
Graph Assembly (graph.py — LangGraph CompiledStateGraph)
    |
Middleware Pipeline (ordered stack: filesystem, subagents, summarization, memory, skills, rubric, permissions, patch_tool_calls)
    |
Backend Protocol (BackendProtocol/SandboxBackendProtocol)
    |
Backend Implementations
  +-- FilesystemBackend (local filesystem, ripgrep)
  +-- StateBackend (in-memory/ephemeral)
  +-- StoreBackend (LangGraph BaseStore, persistent cross-thread)
  +-- SandboxBackend (remote sandboxed shell)
  +-- CompositeBackend (merge multiple)
  +-- ContextHubBackend, LangSmithSandbox
  +-- LocalShellBackend
```

## Key Components (14)

1. **agent-graph** — create_deep_agent, DeltaChannel for O(N) checkpointing, model resolution
2. **middleware-pipeline** — Composable middleware: 10+ middleware types, ordered stack
3. **backends** — BackendProtocol with 7+ implementations (filesystem, state, store, sandbox, composite, etc.)
4. **subagent-system** — SubAgent/AsyncSubAgent specs, task tool delegation, HITL per subagent
5. **skills-system** — SKILL.md spec, progressive disclosure, multi-source layering
6. **memory-system** — AGENTS.md loader, multi-source, system prompt injection
7. **summarization** — Auto token-threshold compaction, tool-based on-demand compact, offload storage
8. **harness-profiles** — Model-specific tuning (Anthropic, OpenAI Codex), provider profiles
9. **security-permissions** — FilesystemPermission rules, path allowlist/denylist, per-subagent permissions
10. **code-agent** — Full CLI TUI: chat, notifications, sessions, MCP auth, themes
11. **acp-server** — Agent Communication Protocol server
12. **evals** — SWE-bench integration, eval harness, failure analysis
13. **error-handling** — LangChain exception hierarchy, FileOperationError literals
14. **quickjs-partner** — Sandboxed JS runtime for skill execution
