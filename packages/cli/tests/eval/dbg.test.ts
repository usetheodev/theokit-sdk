import { describe, expect, it, vi } from "vitest";

vi.mock("@usetheo/sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@usetheo/sdk")>();
  return {
    ...original,
    Agent: {
      ...original.Agent,
      batch: vi.fn(async (prompts: ReadonlyArray<string>) => {
        console.log("[MOCK] Agent.batch called with", prompts.length);
        return prompts.map((p, i) => ({
          ok: true as const,
          index: i,
          prompt: p,
          result: { id: `r${i}`, status: "finished" as const, result: `echoed: ${p}` },
          durationMs: 1,
        }));
      }),
    },
  };
});

it("debug", async () => {
  const { Eval } = await import("@usetheo/sdk");
  console.log("Eval is:", typeof Eval, "Eval.create is:", typeof (Eval as any)?.create);
  const ev = Eval.create({
    name: "dbg",
    dataset: [{ input: "hi" }],
    scorers: [{ name: "s", score: () => ({ score: 1 }) }],
    agent: { apiKey: "local", model: { id: "ollama/x" } } as never,
  });
  console.log("Created. Running...");
  const r = await ev.run();
  console.log("Result:", r);
  expect(r.aggregate.totalRows).toBe(1);
}, 10000);
