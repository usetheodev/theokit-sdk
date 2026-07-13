/**
 * Subscriptions — `tracked` wraps a payload with a resume-token id so a reconnecting client can
 * resume from the last event it saw. Deterministic (no server, no LLM): pure envelope helpers.
 */
import assert from "node:assert/strict";
import { tracked, isTrackedEnvelope } from "@theokit/sdk/subscription";

// A server handler yields `tracked(id, payload)` so each event carries a resume token.
const event = tracked("evt-42", { message: "hello" });
console.log("envelope:   ", JSON.stringify(event));       // [id, payload]
console.log("id:         ", event[0]);
console.log("payload:    ", JSON.stringify(event[1]));

console.log("isTracked(envelope):", isTrackedEnvelope(event));
console.log("isTracked(plain):   ", isTrackedEnvelope({ message: "hi" }));

// --- validate output (assert) ---
assert.equal(event[0], "evt-42");
assert.equal(isTrackedEnvelope(event), true);
assert.equal(isTrackedEnvelope({ message: "hi" }), false);
