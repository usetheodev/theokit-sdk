/**
 * M6-1 durable batch — `Eval.run({persist:{path,key,resume}, classify?})`.
 *
 * Exercises the runner's per-row flush + success-only resume + classify
 * against a deterministic fake agent (no LLM). The fake routes through the
 * manual runner path (`isAgentInstance`: has `send` + `agentId`).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Eval } from "../../src/eval.js";
import type { SDKAgent } from "../../src/types/agent.js";

/** Minimal deterministic SDKAgent — finishes with `reply(input)`; `onSend` observes each call. */
function fakeAgent(reply: (input: string) => string, onSend?: (input: string) => void): SDKAgent {
  return {
    agentId: "agent-fake",
    send: (input: string) => {
      onSend?.(input);
      return Promise.resolve({
        wait: () => Promise.resolve({ status: "finished" as const, result: reply(input) }),
      });
    },
  } as unknown as SDKAgent;
}

describe("Eval.run persist (M6-1)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "theo-eval-persist-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("flushes each row the instant it completes (per-row flush)", async () => {
    const path = join(dir, "flush.jsonl");
    const linesAtSend: number[] = [];
    const agent = fakeAgent(
      (i) => `out-${i}`,
      () => {
        const n = existsSync(path)
          ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).length
          : 0;
        linesAtSend.push(n);
      },
    );
    await Eval.create({
      name: "flush",
      dataset: [{ input: "a" }, { input: "b" }, { input: "c" }],
      scorers: [() => ({ score: 1 })],
      agent,
      concurrency: 1,
    }).run({ persist: { path, key: (r) => r.input } });

    // When send(N) fires, finalize(N-1) has already appended → file holds N-1 lines.
    expect(linesAtSend).toEqual([0, 1, 2]);
  });

  it("resume skips already-persisted (successful) rows", async () => {
    const path = join(dir, "resume.jsonl");
    const sent1: string[] = [];
    await Eval.create({
      name: "resume-1",
      dataset: [{ input: "a" }, { input: "b" }],
      scorers: [() => ({ score: 1 })],
      agent: fakeAgent(
        (i) => `o-${i}`,
        (i) => sent1.push(i),
      ),
      concurrency: 1,
    }).run({ persist: { path, key: (r) => r.input } });
    expect([...sent1].sort()).toEqual(["a", "b"]);

    const sent2: string[] = [];
    const run2 = await Eval.create({
      name: "resume-2",
      dataset: [{ input: "a" }, { input: "b" }, { input: "c" }],
      scorers: [() => ({ score: 1 })],
      agent: fakeAgent(
        (i) => `o-${i}`,
        (i) => sent2.push(i),
      ),
      concurrency: 1,
    }).run({ persist: { path, key: (r) => r.input, resume: true } });

    expect(sent2).toEqual(["c"]); // a + b were skipped
    expect(run2.rows.map((r) => r.input)).toEqual(["c"]);
  });

  it("retries a previously-failed row on resume (failed rows are not 'done')", async () => {
    const path = join(dir, "retry.jsonl");
    // Run 1: scorer fine but the agent errors on "a" → row has `error`, not persisted-as-done.
    await Eval.create({
      name: "retry-1",
      dataset: [{ input: "a" }],
      scorers: [() => ({ score: 1 })],
      agent: {
        agentId: "agent-fail",
        send: () =>
          Promise.resolve({
            wait: () => Promise.resolve({ status: "failed" as const, error: { message: "boom" } }),
          }),
      } as unknown as SDKAgent,
      concurrency: 1,
    }).run({ persist: { path, key: (r) => r.input } });

    const sent2: string[] = [];
    await Eval.create({
      name: "retry-2",
      dataset: [{ input: "a" }],
      scorers: [() => ({ score: 1 })],
      agent: fakeAgent(
        (i) => `o-${i}`,
        (i) => sent2.push(i),
      ),
      concurrency: 1,
    }).run({ persist: { path, key: (r) => r.input, resume: true } });

    expect(sent2).toEqual(["a"]); // failed row IS retried
  });

  it("applies classify to set row.outcome and persists it", async () => {
    const path = join(dir, "classify.jsonl");
    const run = await Eval.create({
      name: "classify",
      dataset: [{ input: "a" }],
      scorers: [() => ({ score: 1 })],
      agent: fakeAgent(() => "ok"),
    }).run({
      persist: { path, key: (r) => r.input },
      classify: (r) => (r.meanScore >= 0.5 ? "pass" : "fail"),
    });

    expect(run.rows[0]?.outcome).toBe("pass");
    const persisted = JSON.parse(readFileSync(path, "utf8").trim());
    expect(persisted.outcome).toBe("pass");
  });

  it("without persist behaves identically (no file, no outcome)", async () => {
    const path = join(dir, "absent.jsonl");
    const run = await Eval.create({
      name: "no-persist",
      dataset: [{ input: "a" }],
      scorers: [() => ({ score: 1 })],
      agent: fakeAgent(() => "ok"),
    }).run();

    expect(run.rows[0]?.outcome).toBeUndefined();
    expect(existsSync(path)).toBe(false);
  });
});
