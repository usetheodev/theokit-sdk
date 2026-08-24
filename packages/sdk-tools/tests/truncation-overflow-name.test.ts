import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { truncateOutput } from "../src/truncation.js";

/**
 * CodeQL `js/insecure-temporary-file` #34. The overflow file's name was
 * `overflow-<Date.now()>-<8 hex chars>.txt` — 32 bits of entropy behind a predictable clock
 * reading — and it was written with a plain `writeFileSync`, which follows a symlink.
 *
 * The content at stake is the *untruncated* output: by construction the largest thing the tool
 * produced, which is what makes it worth redirecting somewhere readable.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "overflow-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it("names the overflow file with full UUID entropy, not a truncated one", async () => {
  truncateOutput("x".repeat(5000), { maxBytes: 100, outputDir: dir });

  const [name] = await readdir(dir);
  // A full v4 UUID is 36 characters with four hyphens. The truncated form carried 8 and none.
  const uuid = (name ?? "").replace(/^overflow-\d+-/, "").replace(/\.txt$/, "");
  expect(uuid).toHaveLength(36);
  expect(uuid.split("-")).toHaveLength(5);
});

// NOT TESTED HERE, and deliberately said rather than left to look covered: that `wx` refuses a
// planted name. With a full UUID the path is unguessable, so a test cannot pre-plant it, and there
// is no injection seam for the filename. A version of this test that planted a symlink at the
// PREVIOUS run's name was written and then deleted — it passed with the defect reintroduced, which
// makes it a tautology, and a tautological test reports coverage it does not have.
//
// The guarantee is structural instead: POSIX requires O_CREAT|O_EXCL to fail when the path exists,
// symlinks included, so there is no window for a check to be right and the write to be wrong.
