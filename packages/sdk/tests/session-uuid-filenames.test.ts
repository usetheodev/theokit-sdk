import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { FsSessionStore } from "../src/internal/persistence/fs-session-store.js";
import {
  isSessionUuid,
  legacyTranscriptPath,
  sessionUuidFor,
  transcriptPath,
} from "../src/internal/persistence/session-transcript.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("sessionUuidFor — #400", () => {
  it("test_a_human_readable_agent_id_becomes_a_uuid_because_the_cli_resumes_nothing_else", () => {
    expect(sessionUuidFor("billing-bot")).toMatch(UUID);
  });

  it("test_the_same_agent_id_always_derives_the_same_uuid_so_no_mapping_has_to_be_stored", () => {
    expect(sessionUuidFor("billing-bot")).toBe(sessionUuidFor("billing-bot"));
  });

  it("test_two_agent_ids_do_not_collide_onto_one_transcript", () => {
    expect(sessionUuidFor("billing-bot")).not.toBe(sessionUuidFor("support-bot"));
  });

  it("test_an_id_that_is_already_a_uuid_passes_through_so_a_cli_written_session_keeps_its_name", () => {
    const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(sessionUuidFor(id)).toBe(id);
  });

  it("test_the_derived_uuid_declares_version_5_and_the_rfc_4122_variant", () => {
    const derived = sessionUuidFor("billing-bot");
    expect(derived[14]).toBe("5");
    expect("89ab").toContain(derived[19]);
  });

  // The accepted case is half the oracle (rules/testing.md § 4.2): without it, a predicate that
  // answered `false` for everything would satisfy every rejection below while forcing a fresh
  // derivation over a real Claude Code session id — renaming a transcript the CLI already owns.
  it("test_a_canonical_uuid_is_recognised", () => {
    expect(isSessionUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
  });

  it("test_a_human_readable_id_is_not_mistaken_for_a_uuid", () => {
    expect(isSessionUuid("billing-bot")).toBe(false);
  });

  it("test_a_uuid_missing_a_group_is_rejected", () => {
    expect(isSessionUuid("3f2504e0-4f89-41d3-0305e82c3301")).toBe(false);
  });
});

describe("transcriptPath — #400", () => {
  it("test_the_transcript_basename_is_a_uuid_so_claude_continue_can_find_it", () => {
    const path = transcriptPath("/base", "/work", "billing-bot");
    expect(basename(path, ".jsonl")).toMatch(UUID);
  });
});

describe("FsSessionStore legacy transcripts — #400", () => {
  let baseDir: string;
  const cwd = "/work/project";

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "session-uuid-"));
  });

  it("test_a_new_session_is_written_under_the_uuid_name", async () => {
    const store = new FsSessionStore({ baseDir, cwd });
    await store.appendRecords("billing-bot", [{ type: "user", uuid: "u1" } as never]);
    const written = transcriptPath(baseDir, cwd, "billing-bot");
    expect(basename(written, ".jsonl")).toMatch(UUID);
    expect(readFileSync(written, "utf8")).toContain("u1");
  });

  // Renaming the scheme must not abandon history. Before the fallback, this agent kept two files:
  // the real one under the old name, and an empty one under the new — and `readRecords` returned
  // the empty one, so the session read as brand new while its turns sat on disk beside it.
  it("test_an_existing_legacy_transcript_keeps_being_the_session_instead_of_being_abandoned", async () => {
    const legacy = legacyTranscriptPath(baseDir, cwd, "billing-bot");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(baseDir, "projects"), { recursive: true });
    mkdirSync(legacy.slice(0, legacy.lastIndexOf("/")), { recursive: true });
    writeFileSync(legacy, `${JSON.stringify({ type: "user", uuid: "old-turn" })}\n`);

    const store = new FsSessionStore({ baseDir, cwd });
    await store.appendRecords("billing-bot", [{ type: "user", uuid: "new-turn" } as never]);

    const records = await store.readRecords("billing-bot");
    expect(records.map((r) => (r as { uuid: string }).uuid)).toEqual(["old-turn", "new-turn"]);
    expect(readFileSync(legacy, "utf8")).toContain("new-turn");
  });
});
