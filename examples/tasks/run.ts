/**
 * Example: Task observability registry (ADRs D361-D374, Adoption Roadmap gap #2).
 *
 * Demonstrates the 5-state lifecycle, subscribe with ring-buffer replay,
 * idempotent cancel, fan-out batch pattern, and JsonFileTaskStore
 * cross-restart persistence.
 *
 * No LLM required — the work functions are deterministic so the example
 * runs offline and quickly. For a real-LLM equivalent, wrap your
 * `agent.send` call inside the `work` callback.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Task } from "@theokit/sdk";

async function main(): Promise<void> {
  // Persist tasks to a temp dir so we can also exercise the CLI verb.
  const dir = mkdtempSync(join(tmpdir(), "theokit-tasks-example-"));
  Task.configure({
    store: { backend: "json", dir: join(dir, "tasks") },
    maxConcurrent: 4,
  });
  console.log(`Using JsonFileTaskStore at ${dir}/tasks\n`);

  // ─── 1. Submit a single task + subscribe to progress ──────────────
  console.log("1) Single task with progress events");
  const handle = await Task.submit("custom", async (ctx) => {
    for (let i = 0; i < 3; i++) {
      ctx.emit({ step: i });
      await sleep(20);
    }
    return "done";
  });

  for await (const event of Task.subscribe(handle.id)) {
    console.log("   event:", event.type, "type" in event ? JSON.stringify(event) : "");
    if (event.type === "finished" || event.type === "errored" || event.type === "cancelled") break;
  }

  // ─── 2. Fan-out batch with parent + children ──────────────────────
  console.log("\n2) Fan-out batch (1 parent + N children)");
  const parent = await Task.submit("batch", async (ctx) => {
    const items = ["alpha", "beta", "gamma"];
    const children = await Promise.all(
      items.map((item) =>
        Task.submit(
          "run",
          async (childCtx) => {
            childCtx.emit({ item });
            await sleep(10);
            return `processed:${item}`;
          },
          { meta: { item } },
        ),
      ),
    );
    return { childCount: children.length, ids: children.map((h) => h.id) };
  });

  await waitForTerminal(parent.id);
  const parentFinal = await Task.get(parent.id);
  console.log(`   parent ${parentFinal?.state}, result:`, parentFinal?.result);

  // ─── 3. Cancel a running task idempotently ────────────────────────
  console.log("\n3) Cancel mid-flight (idempotent)");
  const cancellable = await Task.submit("custom", async (ctx) => {
    return new Promise<string>((_resolve, reject) => {
      ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  });
  await sleep(10);
  const first = await Task.cancel(cancellable.id);
  const second = await Task.cancel(cancellable.id);
  console.log("   first cancel:", first);
  console.log("   second cancel (idempotent):", second);

  // ─── 4. List + filter ──────────────────────────────────────────────
  console.log("\n4) List + filter");
  const allFinished = await Task.list({ state: "finished" });
  const allCancelled = await Task.list({ state: "cancelled" });
  console.log(
    `   ${allFinished.length} finished | ${allCancelled.length} cancelled`,
  );

  console.log(`\n→ Done. Inspect via:`);
  console.log(`   THEOKIT_HOME=${dir} pnpm exec theokit tasks list`);
  console.log(`   THEOKIT_HOME=${dir} pnpm exec theokit tasks inspect <id>`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTerminal(id: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const h = await Task.get(id);
    if (h?.state === "finished" || h?.state === "error" || h?.state === "cancelled") return;
    await sleep(10);
  }
}

main().catch((err) => {
  console.error("example failed:", err);
  process.exit(1);
});
