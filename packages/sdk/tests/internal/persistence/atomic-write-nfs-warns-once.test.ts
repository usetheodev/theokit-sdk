/**
 * The network-filesystem warning must actually fire, and fire ONCE per directory.
 *
 * `atomic-write-nfs-detection.test.ts` covers `detectNetworkFsName` — the magic-number table — and
 * stops there. Nothing exercised `warnOnNetworkFsOnce`, which is the part with behaviour: it is
 * reached from `replaceFileAtomic` (`atomic-write.ts:176`), it consults `statfs`, and it dedupes on
 * a `(dir, label)` key so a hot write path does not emit the same advisory on every call.
 *
 * That gap mattered because the docblock describes the warn-once semantics precisely, and a
 * docblock is the thing people read instead of the code. A table of magic numbers passing says
 * nothing about whether the warning reaches anyone, or whether it reaches them a thousand times.
 *
 * `statfs` is mocked rather than mounted: the assertion is about what the writer DOES with a network
 * verdict, and standing up an NFS share to test a branch would test the mount.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NFS_MAGIC = 0x6969;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, statfs: vi.fn(async () => ({ type: NFS_MAGIC }) as never) };
});

import { setDiagnosticsSink } from "../../../src/internal/diagnostics.js";
import {
  __TESTING__resetNfsWarnings,
  replaceFileAtomic,
} from "../../../src/internal/persistence/atomic-write.js";

let dir: string;
let messages: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "theokit-nfs-warn-"));
  messages = [];
  setDiagnosticsSink((m) => {
    messages.push(m);
  });
  __TESTING__resetNfsWarnings();
});

afterEach(async () => {
  setDiagnosticsSink(undefined);
  __TESTING__resetNfsWarnings();
  await rm(dir, { recursive: true, force: true });
});

describe("warnOnNetworkFsOnce, reached through replaceFileAtomic", () => {
  it("warns when the target directory reports a network filesystem", async () => {
    await replaceFileAtomic(join(dir, "a.json"), "{}");
    expect(messages.join("\n")).toContain("detected network fs");
    expect(messages.join("\n")).toContain("nfs");
  });

  it("warns ONCE per directory, not once per write", async () => {
    // The dedupe is the whole point of the "Once" in the name: `replaceFileAtomic` is on the
    // registry write path, so a per-call advisory would be thousands of identical lines.
    await replaceFileAtomic(join(dir, "a.json"), "{}");
    await replaceFileAtomic(join(dir, "b.json"), "{}");
    await replaceFileAtomic(join(dir, "c.json"), "{}");
    const warnings = messages.filter((m) => m.includes("detected network fs"));
    expect(warnings, "three writes into one directory must produce one advisory").toHaveLength(1);
  });

  it("the file is still written — the warning is advisory, never blocking", async () => {
    const { readFile } = await import("node:fs/promises");
    await replaceFileAtomic(join(dir, "payload.json"), '{"ok":true}');
    expect(await readFile(join(dir, "payload.json"), "utf8")).toBe('{"ok":true}');
  });
});
