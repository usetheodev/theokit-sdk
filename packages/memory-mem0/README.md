# @theokit/memory-mem0

Mem0 **cloud** memory adapter for [`@theokit/sdk`](../sdk).

Wraps [`mem0ai`](https://www.npmjs.com/package/mem0ai) `MemoryClient` with the
`MemoryAdapter` contract from ADR D141. Cloud-only path per ADR D148 (the
OSS local mode duplicates work already shipped in `@theokit/sdk` Memory).

**Unique among `@theokit/memory-*` adapters:** Mem0 supports
`history(id)` — version tracking per memory as facts evolve.

## Install

```bash
pnpm add @theokit/memory-mem0 mem0ai
```

## Usage

```ts
import { Agent } from "@theokit/sdk";
import { mem0Memory } from "@theokit/memory-mem0";

const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  local: {},
  plugins: [mem0Memory({ apiKey: process.env.MEM0_API_KEY! })],
  memoryContext: { userId: "alice" },
});

// Persist + recall (server-side fact extraction)
const id = await agent.memory.write("User likes Brazilian jazz");
const facts = await agent.memory.recall("music?");

// Version history — Mem0-unique capability
const revisions = await agent.memory.adapter()?.history(id);
```

## Security Disclosure (CVE-2026-XXXX / CVSS 8.1)

On **2026-04-17**, a high-severity injection vulnerability (CVSS 8.1) was
disclosed in Mem0 OSS backends — **PGVector, MySQL, and Neptune** —
allowing SQL or Cypher injection via crafted memory text/metadata. The
**Mem0 managed cloud** (the only path this adapter uses) is reported
unaffected by the disclosure.

**Recommendations:**

- If you use this adapter's default configuration (cloud), you are NOT
  exposed to CVE-2026-XXXX.
- If you self-host Mem0 OSS, upgrade to `mem0ai >= 3.0.5` and avoid the
  PGVector / MySQL / Neptune backends until patched.
- Sanitize untrusted user input before passing it to `agent.memory.write`
  regardless — defense in depth.

This adapter (D148) explicitly does NOT support the OSS local mode to
avoid this surface entirely. For local persistence, use `@theokit/sdk`'s
built-in Memory + Active Memory subsystems.

## Options

| Field | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | — | Mem0 API key. Required. |
| `host` | `string` | Mem0 cloud | Override host. |
| `organizationId` | `string` | — | Multi-tenant org scope. |
| `projectId` | `string` | — | Project scope. |
| `breaker.threshold` | `number` | 5 | Consecutive 5xx failures to trip. |
| `breaker.cooldownMs` | `number` | 120_000 | Cooldown duration. |

## Circuit breaker (EC-K)

A per-instance circuit breaker trips after 5 consecutive 5xx failures
and pauses calls for 2 minutes. **429 (rate limit) does NOT count**
toward the trip threshold — rate limits are caller-pace signals, not
provider-down signals.

Per-adapter-instance (EC-R): two `Agent.create({...})` calls with
distinct `mem0Memory({...})` instances have independent breakers. For
shared protection across many agents, pass the SAME plugin instance:

```ts
const sharedPlugin = mem0Memory({ apiKey });
const a = await Agent.create({ plugins: [sharedPlugin] });
const b = await Agent.create({ plugins: [sharedPlugin] });
```

## Failure modes

| What was thrown | Maps to | Trips breaker? |
|---|---|---|
| 401 / 403 | `auth_failed` | no |
| 429 | `rate_limited` | **no** (EC-K) |
| 404 | `not_found` | no |
| 5xx | `network` | yes |
| No status, message contains "network" | `network` | yes |
| No status, any other message (e.g. `"fetch failed"`) | `unknown` | **no** |

The status is read from `.status`, `.statusCode`, `.response.status`, or an `errorCode` of the form
`HTTP_<nnn>` — the last is what `mem0ai` actually attaches. Transport failures are recognised only
by the literal substring `network` in the message, so a DNS or connection error worded differently
lands in `unknown` and leaves the breaker closed.

## API reference

Every symbol this package exports, with the exact specifier to import it from, is in the generated
capability map that ships inside `@theokit/sdk`:

```
node_modules/@theokit/sdk/docs/harness-capability-map.md   # symbol -> import specifier
node_modules/@theokit/sdk/docs/error-codes.md              # every `code` an error can carry
```

Both are generated from the built type declarations, so they describe the version you installed
rather than the version someone wrote a page about.

## License

Apache-2.0. See [LICENSE](./LICENSE).
