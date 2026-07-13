/**
 * Permissions — first-match rules that gate tool calls, resolved per mode.
 *
 * A `PermissionEngine` evaluates a tool name (and optional args) against ordered rules; the first
 * match wins, and an unmatched call falls back to `ask` (fail-closed). The per-run `PermissionMode`
 * layers on top: `plan` blocks mutations, `bypass` auto-allows — but an explicit `deny` is immune
 * to every mode. Deterministic — no LLM.
 */
import assert from "node:assert/strict";
import { PermissionEngine } from "@theokit/sdk";

const engine = new PermissionEngine([
  { tool: "delete_file", action: "deny" },
  { tool: /^read_/, action: "allow" },
]);

console.log("delete_file        :", engine.evaluate("delete_file"));
console.log("read_file          :", engine.evaluate("read_file"));
console.log("send_email (unmatch):", engine.evaluate("send_email"));
console.log("write_file in plan :", engine.evaluate("write_file", undefined, "plan"));
console.log("delete in bypass   :", engine.evaluate("delete_file", undefined, "bypass"));

// --- validate output (assert) ---
assert.equal(engine.evaluate("delete_file"), "deny");
assert.equal(engine.evaluate("read_file"), "allow");
assert.equal(engine.evaluate("send_email"), "ask");
