/**
 * #577 — a consumer listing transcript files can match them to agent ids it holds.
 *
 * Transcript filenames became a one-way UUIDv8 over SHA-256 in #400 so the Claude Code CLI can
 * `--continue` a session this SDK wrote. The scheme needs nothing persisted to map one back — but
 * the function computing it was in zero `.d.ts`, so the only route was to reimplement the hash.
 * Measured cost on `@theokit/agents` 4.x against 5.0.1: 29 failing unit tests.
 */
import { basename } from "node:path";

import { describe, expect, it } from "vitest";

import { legacyTranscriptPath, sessionUuidFor, transcriptPath } from "../src/persistence.js";

const BASE = "/tmp/theokit-probe";
const CWD = "/home/someone/project";

describe("session id ↔ transcript filename", () => {
  it("lets a caller match a listed filename to an id it holds", () => {
    const id = "agent-42";
    const listed = basename(transcriptPath(BASE, CWD, id));

    // What a consumer enumerating the directory actually does.
    expect(listed).toBe(`${sessionUuidFor(id)}.jsonl`);
  });

  it("is stable across calls — the match is not a coincidence of one run", () => {
    expect(sessionUuidFor("agent-42")).toBe(sessionUuidFor("agent-42"));
    // The control: a DIFFERENT id must not produce the same name, or matching proves nothing.
    expect(sessionUuidFor("agent-42")).not.toBe(sessionUuidFor("agent-43"));
  });

  it("passes an id that is already a UUID through unchanged", () => {
    const uuid = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    expect(sessionUuidFor(uuid)).toBe(uuid);
    expect(sessionUuidFor(uuid.toUpperCase())).toBe(uuid);
  });

  it("emits a v8 UUID — the nibble the CLI was measured to accept", () => {
    const uuid = sessionUuidFor("agent-42");
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("exposes the pre-#400 spelling, so old sessions are not reported missing", () => {
    const id = "agent-42";
    const legacy = basename(legacyTranscriptPath(BASE, CWD, id));

    expect(legacy).not.toBe(basename(transcriptPath(BASE, CWD, id)));
    // A directory written before the rename holds BOTH spellings; a consumer matching only the new
    // one reports its own history as absent.
    expect(legacy).toContain(id);
  });
});
