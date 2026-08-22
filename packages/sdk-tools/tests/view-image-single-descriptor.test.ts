import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolResultContentBlock } from "@theokit/sdk";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createViewImageTool } from "../src/view-image.js";

/**
 * CodeQL `js/file-system-race` #22. `view_image` used to `statSync(path)`, check the size cap,
 * then `readFileSync(path)` — two lookups of one name, with a window between them.
 *
 * The race itself cannot be asserted deterministically. What CAN be asserted is the invariant a
 * successful race would break, and which reading through a single descriptor guarantees: the
 * `bytes` the tool reports and the payload it returns describe **the same file**. Under the old
 * shape those could disagree; under the new one they cannot.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "view-image-fd-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A 1x1 PNG — real header bytes, so the tool's type detection is exercised, not bypassed. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

it("returns the bytes of the file it sized, not of whatever the path resolved to next", async () => {
  await writeFile(join(root, "pixel.png"), PNG);
  const tool = createViewImageTool({ projectRoot: root });

  const out = (await tool.handler({ path: "pixel.png" }, {} as never)) as ToolResultContentBlock[];

  // Success returns image blocks. The payload must decode to exactly the file that was sized —
  // `fstat` and the read now share one descriptor, so a second path lookup cannot slip between
  // them and hand back a different file's contents.
  const block = out[0] as { source?: { data?: string } };
  expect(Buffer.from(block.source?.data ?? "", "base64")).toEqual(PNG);
});

it("closes the descriptor on the size-cap path, measured rather than assumed", async () => {
  // Counting open descriptors, not iterations. A loop that merely repeats the call passes
  // whether or not the fd is closed — measured: with the `finally` deleted, 300 iterations still
  // went green, because the budget is far higher than that. `/proc/self/fd` is the fact itself.
  await writeFile(join(root, "big.png"), Buffer.concat([PNG, Buffer.alloc(4096)]));
  const tool = createViewImageTool({ projectRoot: root, maxBytes: 100 });
  const openCount = async (): Promise<number> => (await readdir("/proc/self/fd")).length;

  const before = await openCount();
  for (let i = 0; i < 50; i++) await tool.handler({ path: "big.png" }, {} as never);
  const after = await openCount();

  // The early return on the size cap happens inside the `try`; without the `finally` this grows
  // by 50. Allowing a small delta because the runner opens its own handles during the loop.
  expect(after - before).toBeLessThan(10);
});

it("still refuses a file over the cap with the named error", async () => {
  await writeFile(join(root, "big.png"), Buffer.concat([PNG, Buffer.alloc(4096)]));
  const tool = createViewImageTool({ projectRoot: root, maxBytes: 100 });

  const out = await tool.handler({ path: "big.png" }, {} as never);

  expect((JSON.parse(out as string) as { error?: string }).error).toBe("image_too_large");
});
