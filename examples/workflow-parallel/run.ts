/**
 * Workflow control flow — parallel fan-out then first-match branch. Deterministic (fn steps, no LLM).
 * `.parallel` takes an array of BRANCHES (each branch is an array of steps).
 */
import { Workflow, fn } from "@theokit/sdk/workflow";

const wf = Workflow.create({ name: "control-flow" })
  .then(fn("seed", () => 7))
  .parallel([
    [fn("double", (n) => (n as number) * 2)],
    [fn("square", (n) => (n as number) ** 2)],
  ])
  .branch(
    [[(out) => Array.isArray(out) && (out as number[])[1] > 40, [fn("big", (out) => `big: ${JSON.stringify(out)}`)]]],
    { fallback: [fn("small", (out) => `small: ${JSON.stringify(out)}`)] },
  )
  .commit();

const run = await wf.run(undefined);
console.log("Status:", run.status);
console.log("Output:", run.output);
