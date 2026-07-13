/**
 * Tasks — run work in the background and observe it through the task registry. Deterministic: the
 * work is a plain function (no LLM). submit() returns immediately; we watch it settle via subscribe().
 */
import assert from "node:assert/strict";
import { Task } from "@theokit/sdk";

const handle = await Task.submit(
  "custom",
  async () => {
    await new Promise((r) => setTimeout(r, 10)); // simulate background work
    return 21 * 2;
  },
  { id: "compute-answer" },
);

console.log("submitted:", handle.state);

// subscribe() replays buffered events then yields live ones. Break on the terminal event.
for await (const ev of Task.subscribe(handle.id)) {
  console.log("event:    ", ev.type);
  if (ev.type === "finished" || ev.type === "errored" || ev.type === "cancelled") break;
}

const done = await Task.get(handle.id);
console.log("final:    ", done?.state, "result:", done?.result);

// --- validate output (assert) ---
assert.equal(done?.state, "finished");
assert.equal(done?.result, 42);
