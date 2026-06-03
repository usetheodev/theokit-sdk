# D358 — `agent.json` registry manifest at `packages/acp/registry/`; bin shim `theokit-acp`

- **Status:** Accepted
- **Date:** 2026-05-26
- **Plan:** `acp-server-adapter-plan` (Phase 0)

## Context

ACP registry (https://github.com/agentclientprotocol/registry) hosts a marketplace of agents discoverable by Zed/Cursor. Each entry is an `agent.json` with a distribution method (`command`, `args`).

## Decision

- Registry manifest lives at `packages/acp/registry/agent.json` (shipped via npm `files` field).
- Standalone bin shim `theokit-acp` published from `@theokit/acp/bin/theokit-acp.mjs` so `npx theokit-acp` works without installing the full `@theokit/cli`.
- `distribution.command: "npx"`, `distribution.args: ["theokit-acp", "--entry", "<entry>"]`.

## Rationale

- Discoverable in marketplace.
- `npx theokit-acp` is the minimal install path — users who only want ACP don't need the full CLI.
- Mirrors Hermes' `acp_registry/agent.json` pattern (`distribution.type: "command"`).

## Consequences

- `bin/theokit-acp.mjs` is a 30-line shim that parses flags + dynamic-imports the entry + calls `serveAcp`.
- npm `files` includes `["dist", "bin", "registry"]`.
- Manifest mirrored to docs as a concept page (T6.1).
