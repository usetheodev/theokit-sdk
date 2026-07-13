/**
 * Workflow retry — recover from a transient step failure.
 *
 * Any step can carry a `retry` policy. Here a flaky `fn` step throws twice, then succeeds; the
 * workflow retries with backoff and completes. Non-retryable errors (or exhausting maxAttempts)
 * fail the run instead. No LLM — deterministic.
 */
import { Workflow, fn } from "@theokit/sdk/workflow";

let attempts = 0;

const pipeline = Workflow.create({ name: "retry-demo" })
  .then(
    fn(
      "flaky",
      () => {
        attempts += 1;
        if (attempts < 3) throw new Error(`transient failure (attempt ${attempts})`);
        return `ok after ${attempts} attempts`;
      },
      { retry: { maxAttempts: 3, initialBackoffMs: 50, backoffCoefficient: 2 } },
    ),
  )
  .commit();

const run = await pipeline.run(undefined);

console.log("Status:", run.status);
console.log("Output:", run.output);
