import { expect } from "vitest";

import type { Run, SDKMessage } from "../../src/index.js";

export async function collectStream(run: Run, timeoutMs = 5_000): Promise<SDKMessage[]> {
  expect(typeof run.stream).toBe("function");

  const events: SDKMessage[] = [];
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`run.stream() did not finish within ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  await Promise.race([
    (async () => {
      for await (const event of run.stream()) {
        events.push(event);
      }
    })(),
    timeout,
  ]);

  expect(events, "run.stream() must emit at least one public SDKMessage").not.toHaveLength(0);
  for (const event of events) {
    expect(event).toMatchObject({
      agent_id: expect.any(String),
      run_id: expect.any(String),
      type: expect.any(String),
    });
  }
  return events;
}
