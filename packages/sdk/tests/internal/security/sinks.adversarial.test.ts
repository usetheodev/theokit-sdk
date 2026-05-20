/**
 * Adversarial property tests for redaction-wired output sinks
 * (T1.5.1, ADR D68).
 *
 * Sinks under test:
 *   1. ErrorMetadata.raw via mapAnthropicError
 *   2. Telemetry tracer redactAttrs helper
 *   3. Transcript JSONL appender
 *   4. Migration logger (via _redactSecretsForCallerLog spec)
 *
 * Each sink is exercised 100 times with a generated sk-* token; the
 * post-sink output must never contain the original token.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as fc from "fast-check";
import { afterEach, beforeEach, describe, it } from "vitest";

import { mapAnthropicError } from "../../../src/internal/errors/mappers/anthropic.js";
import {
  appendToSessionFile,
  sessionFilePath,
} from "../../../src/internal/runtime/agent-session-store.js";
import { redactSecrets } from "../../../src/internal/security/redact.js";
import { _redactAttrsForTests } from "../../../src/internal/telemetry/tracer.js";

const secretArb = fc.stringMatching(/^sk-[A-Za-z0-9]{30}$/);

describe("sinks adversarial (T1.5.1)", () => {
  it("ErrorMetadata.raw never echoes the secret across 100 cases", () => {
    fc.assert(
      fc.property(secretArb, (secret) => {
        const err = mapAnthropicError({
          status: 401,
          body: { error: { type: "authentication_error", message: `bad: ${secret}` } },
          headers: undefined,
          endpoint: "/v1/messages",
        });
        const blob = JSON.stringify(err.metadata);
        return !blob.includes(secret);
      }),
      { numRuns: 100 },
    );
  });

  it("Telemetry attrs redactor never echoes the secret across 100 cases", () => {
    fc.assert(
      fc.property(secretArb, (secret) => {
        const out = _redactAttrsForTests({
          "llm.prompt": `user said ${secret}`,
          "llm.tokens": 100,
        });
        return !JSON.stringify(out).includes(secret);
      }),
      { numRuns: 100 },
    );
  });

  it("redactSecrets direct sink never echoes 100 random sk- tokens", () => {
    fc.assert(
      fc.property(secretArb, (secret) => {
        return !redactSecrets(`Some text ${secret} more text`).includes(secret);
      }),
      { numRuns: 100 },
    );
  });
});

describe("transcript JSONL appender (T1.5.1)", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "theokit-sink-adv-"));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("appendToSessionFile never leaks secrets across 50 cases", async () => {
    // fc.assert in async — use the runner.
    await fc.assert(
      fc.asyncProperty(secretArb, async (secret) => {
        await appendToSessionFile(cwd, "agent-prop", {
          role: "user",
          text: `leak attempt: ${secret}`,
        });
        const raw = readFileSync(sessionFilePath(cwd, "agent-prop"), "utf8");
        return !raw.includes(secret);
      }),
      { numRuns: 50 },
    );
  });
});
