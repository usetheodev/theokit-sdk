/**
 * SE41 T2 — `FsSessionStore` is the DEFAULT reference implementation of the
 * `SessionStore` seam: it reads and append-writes the native Claude-shaped
 * `.jsonl` transcript. `readRecords` is `readTranscript(transcriptPath(...))`;
 * `appendRecords` truly APPENDS the delta (never rewriting prior records with
 * different content) under the same cross-process file lock the SE40 store uses,
 * with the `mkdir(dirname)`-before-lock fix preserved. A missing session reads
 * `[]`.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FsSessionStore } from "../../../src/internal/persistence/fs-session-store.js";
import {
  type SessionRecord,
  transcriptPath,
} from "../../../src/internal/persistence/session-transcript.js";

function rec(overrides: Partial<SessionRecord> & Pick<SessionRecord, "uuid">): SessionRecord {
  return {
    type: "user",
    parentUuid: null,
    sessionId: "s1",
    timestamp: "2026-07-15T00:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text: "x" }] },
    ...overrides,
  };
}

describe("FsSessionStore (SE41 T2 — default reference impl of SessionStore)", () => {
  let baseDir: string;
  const cwd = "/tmp/theokit-fsstore-proj";

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "theokit-fsstore-"));
  });
  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("readRecords on a never-written session returns [] (missing file → empty, not throw)", async () => {
    const store = new FsSessionStore({ baseDir, cwd });
    expect(await store.readRecords("agent-missing")).toEqual([]);
  });

  it("appendRecords writes native records to the transcript path; readRecords reads them back", async () => {
    const store = new FsSessionStore({ baseDir, cwd });
    const r1 = rec({ uuid: "u1" });
    await store.appendRecords("agent-a", [r1]);

    // The bytes landed at the canonical native transcript path.
    const path = transcriptPath(baseDir, cwd, "agent-a");
    const raw = await readFile(path, "utf8");
    expect(raw.split("\n").filter((l) => l.length > 0).length).toBe(1);

    expect(await store.readRecords("agent-a")).toEqual([r1]);
  });

  it("appendRecords is a TRUE append — a second call keeps prior records and adds the delta in order", async () => {
    const store = new FsSessionStore({ baseDir, cwd });
    const r1 = rec({ uuid: "u1" });
    const r2 = rec({ uuid: "u2", parentUuid: "u1" });
    const r3 = rec({ uuid: "u3", parentUuid: "u2", type: "assistant" });

    await store.appendRecords("agent-a", [r1]);
    await store.appendRecords("agent-a", [r2, r3]);

    const read = await store.readRecords("agent-a");
    expect(read.map((r) => r.uuid)).toEqual(["u1", "u2", "u3"]);
    // never shrinks / never rewrites prior content
    expect(read[0]).toEqual(r1);
  });

  it("appendRecords with an empty delta is a no-op (prior records untouched)", async () => {
    const store = new FsSessionStore({ baseDir, cwd });
    await store.appendRecords("agent-a", [rec({ uuid: "u1" })]);
    await store.appendRecords("agent-a", []);
    expect((await store.readRecords("agent-a")).map((r) => r.uuid)).toEqual(["u1"]);
  });

  it("per-agent isolation — two agentIds map to two files", async () => {
    const store = new FsSessionStore({ baseDir, cwd });
    await store.appendRecords("agent-a", [rec({ uuid: "a1" })]);
    await store.appendRecords("agent-b", [rec({ uuid: "b1" })]);
    expect((await store.readRecords("agent-a")).map((r) => r.uuid)).toEqual(["a1"]);
    expect((await store.readRecords("agent-b")).map((r) => r.uuid)).toEqual(["b1"]);
  });
});
