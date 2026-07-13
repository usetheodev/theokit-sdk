/**
 * Evals — score a prediction against an expected answer with built-in Scorers. Deterministic: the
 * scorers are pure functions (no LLM). Drop the same scorers into Eval.create to grade a dataset.
 */
import { Scorers } from "@theokit/sdk/eval";

const contains = Scorers.containsExpected();      // case-insensitive substring
const exact = Scorers.exactMatch();               // case-sensitive equality
const rx = Scorers.regex(/\b\d{4}\b/);            // pattern match

console.log("contains:", await contains.score("The capital is Paris.", "paris"));
console.log("exact:   ", await exact.score("Paris", "paris"));
console.log("regex:   ", await rx.score("Released in 2026", undefined));
