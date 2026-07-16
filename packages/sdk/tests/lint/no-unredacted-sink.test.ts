/**
 * Lint gate (T1.5.2, ADR D68) — fails CI when a new output sink lands
 * in `src/` without being wrapped by `redactSecrets`.
 *
 * Sinks under audit: `console.log/info/warn/error`, `writeFile(Sync)`,
 * `appendFile(Sync)`, `span.setAttribute(s)`. Files that legitimately
 * emit raw content (the redactor itself, atomic-write primitives that
 * write opaque blobs already redacted by their caller) live on the
 * whitelist.
 *
 * @internal
 */

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC_ROOT = join(__dirname, "..", "..", "src");

interface Sink {
  label: string;
  pattern: RegExp;
}

const SINK_PATTERNS: Sink[] = [
  { label: "console.log/info/warn/error", pattern: /console\.(?:log|info|warn|error)\s*\(/ },
  { label: "fs.writeFile(Sync)", pattern: /\bwriteFile(?:Sync)?\s*\(/ },
  { label: "fs.appendFile(Sync)", pattern: /\bappendFile(?:Sync)?\s*\(/ },
  { label: "span.setAttribute(s)", pattern: /\bsetAttributes?\s*\(/ },
];

/**
 * Each whitelist entry must justify itself in a comment.
 *
 * - `internal/security/redact.ts` — the redactor itself; recursion would
 *   be silly.
 * - `internal/error-mappers/shared.ts` — wires `redactSecrets` inline
 *   via `truncateRaw`; the audit regex finds `JSON.stringify` not
 *   `redactSecrets` because of formatting (single import + call). The
 *   helper already routes through redact.
 * - `internal/telemetry/tracer.ts` — wraps `setAttribute(s)` via
 *   `redactAttrValue`/`redactAttrs` helpers in the wrapSpan closure;
 *   pattern matcher sees raw `setAttribute(` calls inside the wrapper.
 * - `internal/session/agent-session-store.ts` — appendFile already
 *   wraps payload with `redactSecrets(JSON.stringify(record))`.
 * - `internal/memory/migrate-sqlite-to-lance.ts` — logger wrap is at
 *   module top.
 * - `internal/persistence/atomic-write.ts` — generic blob writer used
 *   by callers that must redact themselves before passing data in.
 * - `internal/persistence/jsonl.ts` — generic JSONL writer (`appendJsonl`)
 *   for the eval harness (M6). Persists caller-supplied eval-row records to a
 *   caller-chosen path; same contract as atomic-write — the consumer owns its
 *   payload. No SDK-originated secret flows through it.
 * - `internal/memory/storage/transcript-store.ts` — uses atomic-write
 *   primitive; caller redacts (consistent with the runtime/session
 *   store approach).
 * - `internal/mcp/token-storage.ts` — writes encrypted OAuth tokens
 *   inside `~/.theokit/mcp-tokens.json`; redacting here would corrupt
 *   the persisted bundle. File perm 0600 + keychain fallback (D41).
 * - `internal/persistence/file-lock.ts` — writes companion lockfile
 *   with empty content for proper-lockfile semantics; no payload.
 * - `internal/llm/*` clients — call `setAttributes` on local nooperands,
 *   not on tracer spans; or output is already redacted upstream.
 * - `internal/agent-loop/loop.ts` + `tool-dispatch.ts` — all `setAttribute`
 *   callsites use spans returned by `telemetry.startSpan(...)` (or a
 *   child span), which are pre-wrapped via `wrapSpan` in
 *   `internal/telemetry/tracer.ts`. The wrap routes every attr through
 *   `redactAttrValue`/`redactAttrs`. Direct callsites here are
 *   structurally safe.
 * - `internal/workflow/telemetry.ts` — `setAttribute` here is a TYPE
 *   definition on the `SpanLike` interface, not a runtime call. The
 *   only span instances callers receive come from `@opentelemetry/api`
 *   (when installed) or the local `noopSpan` (which does nothing). No
 *   raw value ever flows out of this file. (ADR D241.)
 * - `internal/cache/telemetry.ts`, `internal/eval/telemetry.ts`,
 *   `internal/handoff/telemetry.ts` — same `SpanLike` type-only pattern
 *   as workflow/telemetry. No runtime sink. (ADRs D262, D206, D220.)
 * - `internal/cache/lookup.ts`, `internal/cache/store-handler.ts` —
 *   `span.setAttribute(...)` calls on OTel spans returned by the
 *   wrapped tracer. The wrapping in `internal/telemetry/tracer.ts`
 *   routes every attribute through `redactAttrValue`/`redactAttrs`.
 *   Same rationale as `internal/agent-loop/loop.ts`. The two
 *   `console.warn(...)` callsites print static labels + an
 *   `err.message` already shaped by the cache module itself, not
 *   user-supplied data. (ADR D252.)
 * - `internal/cache/store-json.ts` — `console.warn(...)` prints file
 *   paths + `err.message`; paths live under `$THEOKIT_HOME/cache/`
 *   (no secrets) and `err.message` originates from `node:fs`. No raw
 *   user payload is logged. (ADR D265.)
 * - `internal/eval/runner.ts`, `internal/workflow/executor.ts`,
 *   `internal/workflow/ctx.ts` — `span.setAttribute(...)` on
 *   tracer-wrapped spans (same rationale as agent-loop/loop.ts).
 *   `console.warn(...)` callsites print static prefixes + sanitized
 *   `err.message` only. (ADRs D206, D241.)
 */
const WHITELIST = new Set<string>([
  "internal/security/redact.ts",
  "internal/error-mappers/shared.ts",
  "internal/telemetry/tracer.ts",
  "internal/session/agent-session-store.ts",
  "internal/memory/migrate-sqlite-to-lance.ts",
  "internal/persistence/atomic-write.ts",
  "internal/persistence/jsonl.ts",
  "internal/persistence/exclusive-create.ts",
  "internal/persistence/file-lock.ts",
  "internal/persistence/schema-version.ts",
  "internal/memory/storage/transcript-store.ts",
  "internal/mcp/token-storage.ts",
  "internal/runtime/registry/agent-registry-store.ts",
  "internal/agent-loop/loop.ts",
  // `setAttribute(s)` callsites use spans returned by `telemetry.startSpan(...)`,
  // pre-wrapped via `wrapSpan` in `internal/telemetry/tracer.ts`. Structurally safe.
  // Extracted from loop.ts during G8 LoC split.
  "internal/agent-loop/loop-llm-stream.ts",
  "internal/agent-loop/tool-dispatch.ts",
  "internal/workflow/telemetry.ts",
  "internal/workflow/executor.ts",
  "internal/workflow/ctx.ts",
  "internal/eval/telemetry.ts",
  "internal/eval/runner.ts",
  // `setAttribute` here is a TYPE definition on the shared `SpanLike` interface,
  // not a runtime call. All consumers obtain spans via `getTracer(...)` which
  // returns OTel-wrapped spans; redaction is handled at the agent-loop tracer
  // wrapper level (ADRs D206/D220/D241/D262 — shared loader extracted from
  // those four telemetry modules to remove duplicate clones).
  "internal/observability/tracer-loader.ts",
  // `span.setAttributes(...)` on OTel tracer-wrapped spans in the active
  // memory module — same rationale as agent-loop/loop.ts (redacted via
  // `wrapSpan` in telemetry/tracer.ts).
  "internal/memory/active-memory.ts",
  // `span.setAttribute(...)` on tracer-wrapped spans in the Agent facade —
  // agentId and workspaceCwd are non-secret structural labels.
  "agent.ts",
  // Extracted from agent.ts during G8 LoC split — same span.setAttribute
  // callsites (agentId + workspaceCwd) on pre-wrapped tracer spans.
  "agent-helpers.ts",
  // G8 subscription server-integration: `fs.writeFile` persists the
  // SubscriptionManifest (declarative registry — version + subscription names
  // + zod-derived input/output schemas). No user payload, no PII, no secrets.
  // Manifest is loaded back at server boot to mount routes.
  "subscription/internal/server-integration.ts",
  // SandboxBackend abstract class has `console.error(...)` in the default
  // error handler for derived ops (readFile, writeFile, etc.). The error
  // message originates from the sandbox process itself, not user payload.
  "sandbox/types.ts",
  // SE31 FilesystemBackend seam: the `writeFile(...)` matches are the backend's
  // own METHOD name (contract mirroring node:fs + Mastra), not a logging sink.
  // The actual `fsWriteFile` call is an aliased `node:fs/promises` import that
  // persists caller-provided content to a caller-specified path — a storage
  // primitive (same rationale as internal/persistence/atomic-write.ts), not an
  // output sink that could leak secrets.
  "filesystem/types.ts",
  "filesystem/local-filesystem.ts",
]);

interface Offender {
  file: string;
  sinkLabel: string;
  line: number;
  excerpt: string;
}

async function walkTs(dir: string, out: string[] = []): Promise<string[]> {
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) {
      await walkTs(full, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function scanFile(file: string, content: string): Offender[] {
  if (content.includes("redactSecrets")) return [];
  const out: Offender[] = [];
  for (const [idx, raw] of content.split("\n").entries()) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      continue;
    }
    for (const { label, pattern } of SINK_PATTERNS) {
      if (pattern.test(raw)) {
        out.push({ file, sinkLabel: label, line: idx + 1, excerpt: trimmed });
      }
    }
  }
  return out;
}

describe("lint: no unredacted output sinks in src/ (T1.5.2)", () => {
  it("whitelist entries all exist on disk (EC-6 fix)", () => {
    for (const rel of WHITELIST) {
      const abs = join(SRC_ROOT, rel);
      expect(
        existsSync(abs),
        `whitelist entry stale: ${rel} (refactor moved or removed the file?)`,
      ).toBe(true);
    }
  });

  it("scans src/ for unredacted sinks (informational + gate)", async () => {
    const files = await walkTs(SRC_ROOT);
    const offenders: Offender[] = [];
    for (const file of files) {
      const rel = relative(SRC_ROOT, file).replace(/\\/g, "/");
      if (WHITELIST.has(rel)) continue;
      const content = await readFile(file, "utf8");
      offenders.push(...scanFile(rel, content));
    }
    if (offenders.length > 0) {
      process.stderr.write(
        `\nUnredacted output sinks detected (${offenders.length}). Either route through redactSecrets, or add the file to WHITELIST with rationale:\n` +
          offenders
            .map(
              (o) => `  - ${o.file}:${o.line} (${o.sinkLabel})\n      ${o.excerpt.slice(0, 120)}`,
            )
            .join("\n"),
      );
    }
    expect(offenders).toEqual([]);
  });
});
