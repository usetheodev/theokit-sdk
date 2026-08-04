/**
 * The goal-loop's continuation marker — in a LEAF module, on purpose.
 *
 * Ele vivia em `goal-loop.ts` e era importado por `run-until.ts`, que o `goal-loop` por sua vez
 * imports back. The cycle was broken at runtime (the return edge is `import type` + a dynamic
 * `await import()`), but the cycle detector counts the dynamic edge — and counting a dynamic import as a cycle
 * makes the gate impossible to satisfy without abandoning the canonical cycle-breaking technique.
 *
 * A constant shared by two modules that know each other is the textbook case for extraction into a
 * leaf: neither needs to import the other to know it. The cycle disappears under ANY detector, with no
 * tool policy and without changing a line of behavior.
 */
export const GOAL_CONTINUATION_MARKER = "[[theokit:goal-continuation]]";
