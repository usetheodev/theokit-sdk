import { describe, expect, it } from "vitest";
import { JobQueue } from "../../src/infra/job-queue.js";

describe("JobQueue", () => {
  it("enqueue returns a job ID immediately", () => {
    const q = new JobQueue();
    const id = q.enqueue(async () => 42);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("job transitions to completed on success", async () => {
    const q = new JobQueue();
    const id = q.enqueue(async () => "done");
    // Wait for microtask
    await new Promise((r) => setTimeout(r, 10));
    const job = q.getJob(id);
    expect(job?.status).toBe("completed");
    expect(job?.result).toBe("done");
  });

  it("job transitions to failed on rejection", async () => {
    const q = new JobQueue();
    const id = q.enqueue(async () => {
      throw new Error("oops");
    });
    await new Promise((r) => setTimeout(r, 10));
    const job = q.getJob(id);
    expect(job?.status).toBe("failed");
    expect(job?.error).toBe("oops");
  });

  it("EC-1: synchronous throw in fn becomes failed job", async () => {
    const q = new JobQueue();
    const id = q.enqueue(() => {
      throw new Error("sync boom");
    });
    await new Promise((r) => setTimeout(r, 10));
    const job = q.getJob(id);
    expect(job?.status).toBe("failed");
    expect(job?.error).toBe("sync boom");
  });

  it("list returns all enqueued jobs", () => {
    const q = new JobQueue();
    q.enqueue(async () => 1);
    q.enqueue(async () => 2);
    expect(q.list()).toHaveLength(2);
  });

  it("cancel marks a running job as cancelled", () => {
    const q = new JobQueue();
    const id = q.enqueue(() => new Promise((r) => setTimeout(r, 1000)));
    expect(q.cancel(id)).toBe(true);
    expect(q.getJob(id)?.status).toBe("cancelled");
  });

  it("cancel returns false for unknown job ID", () => {
    const q = new JobQueue();
    expect(q.cancel("nonexistent")).toBe(false);
  });

  it("cancel returns false for already completed job", async () => {
    const q = new JobQueue();
    const id = q.enqueue(async () => "fast");
    await new Promise((r) => setTimeout(r, 10));
    expect(q.cancel(id)).toBe(false);
  });

  it("getJob returns undefined for unknown ID", () => {
    const q = new JobQueue();
    expect(q.getJob("nope")).toBeUndefined();
  });
});
