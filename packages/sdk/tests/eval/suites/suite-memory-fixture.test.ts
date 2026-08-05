/**
 * Eval suite — memory recall/write via FIXTURE MODE (deterministic, always runs).
 *
 * A `theo_test_*` API key runs the REAL local agent pipeline but returns
 * baked-in fixture responses (documented contract, like Stripe test keys), so
 * this suite exercises `Eval.create` -> `Agent.batch` -> run -> scorer ->
 * `assertEval` end to end against the memory capability with zero token spend.
 *
 * Memory recall requires facts to already exist on disk: the fixture responder
 * reads `<cwd>/.theokit/memory/MEMORY.md` (via `readMemoryFacts`) to build the
 * recall haystack. `Agent.batch` fans out isolated agents per input, so a
 * "recall" row cannot rely on a "write" row's ordering — the store must be
 * seeded up front. We therefore run the eval against a seeded temp workspace
 * (NOT `process.cwd()`, which would write the repo). Everything else mirrors
 * the QA fixture suite: `theo_test_eval` key, `openai/gpt-4o-mini`, sandbox off.
 *
 * The seeded facts and prompts are the exact strings the fixture matches; the
 * `expected` values are the deterministic outputs of `memoryRecallScript` /
 * `memoryWriteScript`:
 *   - recall "test runner"  -> "Vitest"           (recallFromHaystack /vitest/i)
 *   - recall "answer"        -> "The answer is 42." (recallFromHaystack \\d{2,})
 *   - write  "Remember: ..." -> "Remembered: <fact>" (extractMemoryFact strips ".")
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertEval, Eval, Scorers } from "../../../src/eval.js";

let cwd: string;

beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), "theokit-eval-memory-"));
  const memoryDir = join(cwd, ".theokit", "memory");
  await mkdir(memoryDir, { recursive: true });
  // Seed the `## Facts` section the fixture recall haystack reads from.
  await writeFile(
    join(memoryDir, "MEMORY.md"),
    "# Memory\n\n## Facts\n\n- preferred test runner is Vitest\n- the answer is 42\n",
    "utf8",
  );
});

afterAll(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("eval suite: memory recall/write (fixture mode)", () => {
  it("recalls and writes durable facts deterministically and clears the gate", async () => {
    const run = await Eval.create({
      name: "fixture-memory",
      dataset: [
        // Recall: "test runner" -> haystack fact matching /vitest/i -> "Vitest".
        { input: "What is my preferred test runner?", expected: "Vitest" },
        // Recall: "answer" -> haystack fact with a 2+ digit number -> "The answer is 42.".
        { input: "What answer did I ask you to remember?", expected: "The answer is 42." },
        // Write: "Remember: <fact>." -> "Remembered: <fact>" (trailing "." stripped).
        {
          input: "Remember: preferred test runner is Vitest.",
          expected: "Remembered: preferred test runner is Vitest",
        },
      ],
      scorers: [Scorers.exactMatch(), Scorers.containsExpected()],
      agent: {
        apiKey: "theo_test_eval",
        model: { id: "openai/gpt-4o-mini" },
        memory: { enabled: true },
        local: { cwd, sandboxOptions: { enabled: false } as const },
      },
      concurrency: 2,
    }).run();

    assertEval(run, { minMeanScore: 1, minPassRatio: 1, maxErrorRatio: 0 });
    expect(run.aggregate.errorRows).toBe(0);
    expect(run.aggregate.totalRows).toBe(3);
  });
});
