/**
 * Compaction — decide when a transcript is about to overflow the context window. Deterministic.
 *
 * `estimateTokens` gives a cheap char-based token estimate; `shouldCompact` compares it to the
 * model's window minus a reserved buffer. Use it to trigger a summary before the next request.
 */
import assert from "node:assert/strict";
import { estimateTokens, shouldCompact } from "@theokit/sdk/compaction";

const transcript = "hello world ".repeat(50);

console.log("Estimated tokens:", estimateTokens(transcript));
console.log("Near limit? ", shouldCompact({ estimated: 9700, contextWindow: 10000, buffer: 500 }));
console.log("Room left?  ", shouldCompact({ estimated: 5000, contextWindow: 10000, buffer: 500 }));

// --- validate output (assert) ---
assert.equal(estimateTokens(transcript), 150);
assert.equal(shouldCompact({ estimated: 9700, contextWindow: 10000, buffer: 500 }), true);
assert.equal(shouldCompact({ estimated: 5000, contextWindow: 10000, buffer: 500 }), false);
