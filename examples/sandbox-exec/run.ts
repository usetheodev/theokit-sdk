/**
 * Sandbox — run a shell command through a pluggable execution backend. Deterministic: LocalSandbox
 * shells out to the host; we run a fixed command and read back stdout + exitCode (no LLM).
 *
 * NOTE: LocalSandbox is NOT an isolation boundary (same user/host). For untrusted code use a
 * Docker/E2B backend — the SandboxBackend interface is identical.
 */
import assert from "node:assert/strict";
import { LocalSandbox } from "@theokit/sdk/sandbox";

const sandbox = new LocalSandbox();

const ok = await sandbox.execute("echo hello from the sandbox");
console.log("stdout:  ", ok.stdout.trim());
console.log("exitCode:", ok.exitCode);

const fail = await sandbox.execute("this-command-does-not-exist");
console.log("failed? ", fail.exitCode !== 0);

// --- validate output (assert) ---
assert.equal(ok.exitCode, 0);
assert.match(ok.stdout, /hello from the sandbox/);
assert.ok(fail.exitCode !== 0);
