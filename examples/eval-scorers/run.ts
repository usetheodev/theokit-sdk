/**
 * Evals — score a prediction against an expected answer with built-in Scorers. Deterministic: the
 * scorers are pure functions (no LLM). Drop the same scorers into Eval.create to grade a dataset.
 */
import assert from "node:assert/strict";
import { Scorers } from "@theokit/sdk/eval";

const contains = Scorers.containsExpected();      // case-insensitive substring
const exact = Scorers.exactMatch();               // case-sensitive equality
const rx = Scorers.regex(/\b\d{4}\b/);            // pattern match

const containsScore = await contains.score("The capital is Paris.", "paris");
const exactScore = await exact.score("Paris", "paris");
const regexScore = await rx.score("Released in 2026", undefined);

console.log("contains:", containsScore);
console.log("exact:   ", exactScore);
console.log("regex:   ", regexScore);

// --- validate output (assert) ---
assert.equal(containsScore.score, 1);
assert.equal(exactScore.score, 0);
assert.equal(regexScore.score, 1);
